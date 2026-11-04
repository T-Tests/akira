/**
 * LLM batch-tagging: draft movies -> 0-3 severities + value tags + takeaway/advisory.
 *   npm run tag -- --limit 25            (tags drafts, leaves is_published=false for review)
 *   npm run tag -- --limit 25 --publish  (auto-publish when confidence >= 0.8)
 *
 * Parents-guide text is read from data/parents-guides/<tmdb_id>.txt (you supply it from
 * licensed/permitted sources or your own curation; do NOT scrape IMDb - it violates their terms).
 * Without a file, the model uses only the TMDB overview and confidence is capped by the prompt rules.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const { values: a } = parseArgs({
  options: { limit: { type: 'string', default: '20' }, publish: { type: 'boolean', default: false } },
});

const sev = z.number().int().min(0).max(3);
const Tag = z.object({
  tmdb_id: z.number().int(),
  violence: sev, scariness: sev, language: sev,
  sexual_content: sev, mature_themes: sev, lgbtq_themes: sev,
  notes: z.record(z.string()).default({}),
  values: z.array(z.object({
    slug: z.enum(['resilience', 'stem', 'empathy', 'teamwork', 'problem_solving', 'environment', 'creativity', 'honesty', 'diversity']),
    strength: z.number().int().min(1).max(3),
  })).max(4),
  takeaway: z.string().min(10).max(400),
  advisory: z.string().min(3).max(400),
  recommended_min_age: z.number().int().min(0).max(18),
  confidence: z.number().min(0).max(1),
});

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const template = await readFile(new URL('../prompts/tagging.prompt.md', import.meta.url), 'utf8');

async function callLLM(prompt: string): Promise<unknown> {
  const res = await fetch(`${process.env.LLM_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${await res.text()}`);
  const j: any = await res.json();
  return JSON.parse(j.choices[0].message.content);
}

async function guideFor(tmdbId: number) {
  try { return await readFile(`data/parents-guides/${tmdbId}.txt`, 'utf8'); } catch { return '(none provided)'; }
}

const { data: drafts, error } = await db
  .from('movies')
  .select('id,tmdb_id,title,release_year,overview')
  .eq('review_status', 'draft')
  .limit(Number(a.limit));
if (error) throw error;

const { data: valueRows } = await db.from('inspirational_values').select('id,slug');
const valueId = new Map(valueRows!.map((v) => [v.slug, v.id]));

// Gemini free tier allows roughly 10 requests/min; override with LLM_DELAY_MS.
const delay = Number(process.env.LLM_DELAY_MS ?? 7000);
for (const m of drafts ?? []) {
  await new Promise((r) => setTimeout(r, delay));
  try {
    const prompt = template
      .replace('{{title}}', m.title).replace('{{year}}', String(m.release_year ?? ''))
      .replace('{{tmdb_id}}', String(m.tmdb_id)).replace('{{overview}}', m.overview ?? '')
      .replace('{{parents_guide}}', await guideFor(m.tmdb_id));

    const t = Tag.parse(await callLLM(prompt));
    if (t.tmdb_id !== m.tmdb_id) throw new Error('tmdb_id mismatch');
    const hasGuide = (await guideFor(m.tmdb_id)) !== '(none provided)';

    const cw = await db.from('content_warnings').upsert({
      movie_id: m.id, violence: t.violence, scariness: t.scariness, language: t.language,
      sexual_content: t.sexual_content, mature_themes: t.mature_themes, lgbtq_themes: t.lgbtq_themes,
      notes: t.notes, source: 'llm', confidence: t.confidence,
      tagged_by: process.env.LLM_MODEL, tagged_at: new Date().toISOString(),
    });
    if (cw.error) throw cw.error;

    await db.from('movie_values').delete().eq('movie_id', m.id);
    if (t.values.length) {
      const mv = await db.from('movie_values').insert(
        t.values.map((v) => ({ movie_id: m.id, value_id: valueId.get(v.slug)!, strength: v.strength })),
      );
      if (mv.error) throw mv.error;
    }

    const publish = a.publish && hasGuide && t.confidence >= 0.8;
    const up = await db.from('movies').update({
      takeaway: t.takeaway, advisory: t.advisory, recommended_min_age: t.recommended_min_age,
      review_status: 'llm_tagged', is_published: publish,
    }).eq('id', m.id);
    if (up.error) throw up.error;
    console.log(`✓ ${m.title} conf=${t.confidence} ${publish ? '[published]' : '[needs review]'}`);
  } catch (e) {
    console.error(`✗ ${m.title}:`, (e as Error).message);
  }
}
