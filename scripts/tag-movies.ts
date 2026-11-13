/**
 * LLM batch-tagging: draft movies -> 0-3 severities + value tags + takeaway/advisory.
 *   npm run tag -- --limit 25            (tags drafts and publishes to Adults)
 *   npm run tag -- --limit 25 --auto     (legacy flag; same single-pass behavior)
 *
 * Parents-guide text is read from data/parents-guides/<tmdb_id>.txt (you supply it from
 * licensed/permitted sources or your own curation; do NOT scrape IMDb - it violates their terms).
 * Without a file, the model uses only the TMDB overview.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { Tag, fillPrompt, parseJsonSafe } from '../supabase/functions/_shared/tagging.ts';

const { values: a } = parseArgs({
  options: {
    limit: { type: 'string', default: '20' },
    auto: { type: 'boolean', default: false },
    'max-minutes': { type: 'string' },   // stop starting new films after this many minutes
  },
});

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

type Endpoint = { baseUrl?: string; key?: string; model?: string };
const geminiKey = process.env.GEMINI_API_KEY?.trim();
const primary: Endpoint = {
  baseUrl: process.env.LLM_BASE_URL || (geminiKey ? 'https://generativelanguage.googleapis.com/v1beta/openai' : undefined),
  key: geminiKey || process.env.LLM_API_KEY?.trim(),
  model: process.env.GEMINI_MODEL?.trim() || process.env.LLM_MODEL?.trim() || (geminiKey ? 'gemini-2.5-flash' : undefined),
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
  return parseJsonSafe(j.choices[0].message.content);
}

async function guideFor(tmdbId: number) {
  try { return await readFile(`data/parents-guides/${tmdbId}.txt`, 'utf8'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '(none provided)'; throw e; }
}

const { data: drafts, error } = await db
  .from('movies')
  .select('id,tmdb_id,title,release_year,overview,audience,original_language')
  .eq('review_status', 'draft')
  .order('tmdb_vote_avg', { ascending: false, nullsFirst: false }) // best-rated first when the backlog is large
  .limit(Math.min(Number(a.limit), 1000)); // PostgREST returns at most 1000 rows per request
if (error) throw error;
if ((drafts?.length ?? 0) > 0 && !primary.key) {
  throw new Error('GEMINI_API_KEY (or LLM_API_KEY) is required to tag draft movies.');
}

// Gemini free tier allows roughly 15 requests/min (4s delay); override with LLM_DELAY_MS.
const isGemini = Boolean(geminiKey) || Boolean(primary.baseUrl?.includes('generativelanguage.googleapis.com'));
const defaultDelay = isGemini ? 4000 : 7000;
const delay = Number(process.env.LLM_DELAY_MS ?? defaultDelay);
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
    const saved = await db.rpc('complete_movie_tagging', { p_movie_id: m.id, p_tag: t, p_model: primary.model });
    if (saved.error) throw saved.error;
    console.log(`✓ ${m.title} [published to Adults${m.audience !== 'adults' ? '; Kids review pending' : ''}]`);
  } catch (e) {
    failed++;
    console.error(`✗ ${m.title}:`, (e as Error).message);
  }
}
console.log(`Processed ${attempted}, failed ${failed}.`);
// Individual bad model outputs are retried next run; only fail the job when nothing succeeded.
if (attempted > 0 && failed === attempted) process.exitCode = 1;
