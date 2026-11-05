/**
 * LLM batch-tagging: draft movies -> 0-3 severities + value tags + takeaway/advisory.
 *   npm run tag -- --limit 25            (tags drafts, leaves is_published=false for review)
 *   npm run tag -- --limit 25 --auto     (AI review: second independent strict-reviewer pass;
 *                                         auto-publish only when both passes agree and confidence is high)
 *
 * Parents-guide text is read from data/parents-guides/<tmdb_id>.txt (you supply it from
 * licensed/permitted sources or your own curation; do NOT scrape IMDb - it violates their terms).
 * Without a file, the model uses only the TMDB overview and confidence is capped by the prompt rules.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { Tag, STRICT_PREFIX, fillPrompt } from '../supabase/functions/_shared/tagging.ts';

const { values: a } = parseArgs({
  options: {
    limit: { type: 'string', default: '20' },
    auto: { type: 'boolean', default: false },
    'max-minutes': { type: 'string' },   // stop starting new films after this many minutes
  },
});

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

type Endpoint = { baseUrl?: string; key?: string; model?: string };
const primary: Endpoint = { baseUrl: process.env.LLM_BASE_URL, key: process.env.LLM_API_KEY, model: process.env.LLM_MODEL };
// Optional second model (e.g. gpt-oss:20b-cloud on Ollama) for the auditor pass; falls back to the primary.
const auditor: Endpoint = {
  baseUrl: process.env.LLM_AUDIT_BASE_URL || primary.baseUrl,
  key: process.env.LLM_AUDIT_API_KEY || primary.key,
  model: process.env.LLM_AUDIT_MODEL || primary.model,
};

async function callLLM(prompt: string, temperature = 0.1, ep: Endpoint = primary): Promise<unknown> {
  const res = await fetch(`${ep.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ep.key}` },
    body: JSON.stringify({
      model: ep.model,
      temperature,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  return JSON.parse(j.choices[0].message.content);
}

const CATS = ['violence', 'scariness', 'language', 'sexual_content', 'mature_themes', 'lgbtq_themes'] as const;
// Kids ratings must match exactly; adult ratings may differ by 1 (filters there are coarser).
const MAX_DIFF = { kids: 0, adults: 1, both: 0 } as const;
const MIN_CONF = { kids: 0.85, adults: 0.75, both: 0.85 } as const;

async function guideFor(tmdbId: number) {
  try { return await readFile(`data/parents-guides/${tmdbId}.txt`, 'utf8'); } catch { return '(none provided)'; }
}

const { data: drafts, error } = await db
  .from('movies')
  .select('id,tmdb_id,title,release_year,overview,audience,original_language')
  .eq('review_status', 'draft')
  .order('tmdb_vote_avg', { ascending: false, nullsFirst: false }) // best-rated first when the backlog is large
  .limit(Math.min(Number(a.limit), 1000)); // PostgREST returns at most 1000 rows per request
if (error) throw error;
if ((drafts?.length ?? 0) > 0 && (!primary.key || (a.auto && !auditor.key))) {
  throw new Error('LLM_API_KEY (and LLM_AUDIT_API_KEY if set up) is required to tag draft movies.');
}

const { data: valueRows } = await db.from('inspirational_values').select('id,slug');
const valueId = new Map(valueRows!.map((v) => [v.slug, v.id]));

// Gemini free tier allows roughly 10 requests/min; override with LLM_DELAY_MS.
const delay = Number(process.env.LLM_DELAY_MS ?? 7000);
let failed = 0;
let attempted = 0;
const deadline = a['max-minutes'] ? Date.now() + Number(a['max-minutes']) * 60_000 : Infinity;
for (const m of drafts ?? []) {
  if (Date.now() > deadline) { console.log('Time budget reached; remaining drafts stay queued for the next run.'); break; }
  attempted++;
  await new Promise((r) => setTimeout(r, delay));
  try {
    const prompt = fillPrompt({
      title: m.title, year: String(m.release_year ?? ''), tmdb_id: String(m.tmdb_id), audience: m.audience,
      language: m.original_language ?? 'unknown', overview: m.overview ?? '', parents_guide: await guideFor(m.tmdb_id),
    });

    const t = Tag.parse(await callLLM(prompt));
    if (t.tmdb_id !== m.tmdb_id) throw new Error('tmdb_id mismatch');
    // Independent second opinion; the stricter (higher) severity always wins.
    let agree = false;
    let sevs: Record<(typeof CATS)[number], number> = Object.fromEntries(CATS.map((c) => [c, t[c]])) as any;
    if (a.auto) {
      const t2 = Tag.parse(await callLLM(STRICT_PREFIX + prompt, 0.4, auditor));
      if (t2.tmdb_id !== m.tmdb_id) throw new Error('auditor tmdb_id mismatch');
      const aud = m.audience as keyof typeof MAX_DIFF;
      agree = CATS.every((c) => Math.abs(t[c] - t2[c]) <= MAX_DIFF[aud])
        && Math.min(t.confidence, t2.confidence) >= MIN_CONF[aud]
        && Math.abs(t.recommended_min_age - t2.recommended_min_age) <= 2;
      sevs = Object.fromEntries(CATS.map((c) => [c, Math.max(t[c], t2[c])])) as any;
      await new Promise((r) => setTimeout(r, delay));
    }

    const cw = await db.from('content_warnings').upsert({
      movie_id: m.id, ...sevs,
      notes: t.notes, source: 'llm', confidence: t.confidence,
      tagged_by: a.auto && auditor.model !== primary.model ? `${primary.model}+${auditor.model}` : primary.model, tagged_at: new Date().toISOString(),
    });
    if (cw.error) throw cw.error;

    await db.from('movie_values').delete().eq('movie_id', m.id);
    if (t.values.length) {
      const mv = await db.from('movie_values').insert(
        t.values.map((v) => ({ movie_id: m.id, value_id: valueId.get(v.slug)!, strength: v.strength })),
      );
      if (mv.error) throw mv.error;
    }

    const publish = a.auto && agree;
    const up = await db.from('movies').update({
      takeaway: t.takeaway, advisory: t.advisory, recommended_min_age: t.recommended_min_age,
      review_status: publish ? 'auto_approved' : 'llm_tagged', is_published: publish,
    }).eq('id', m.id);
    if (up.error) throw up.error;
    console.log(`✓ ${m.title} conf=${t.confidence} ${publish ? '[auto-published]' : '[needs human review]'}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${m.title}:`, (e as Error).message);
  }
}
console.log(`Processed ${attempted}, failed ${failed}.`);
// Individual bad model outputs are retried next run; only fail the job when nothing succeeded.
if (attempted > 0 && failed === attempted) process.exitCode = 1;
