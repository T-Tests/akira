// On-demand lookup: search TMDB, or add one film (metadata + availability + single-LLM tagging) and
// publish it as 'ai_reviewed'. Deploy: supabase functions deploy lookup --no-verify-jwt
// Secrets: TMDB_READ_TOKEN, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, optional ONDEMAND_DAILY_CAP
import { createClient } from '@supabase/supabase-js';
import { Tag, fillPrompt } from '../_shared/tagging.ts';

const COUNTRIES = ['IN', 'US', 'GB', 'CA', 'AU', 'AE']; // keep aligned with lib/constants.ts
const TYPES = ['flatrate', 'free', 'ads'];
const SEARCH_PER_HOUR = 30;
const ADD_PER_HOUR = 8;
const DAILY_CAP = Number(Deno.env.get('ONDEMAND_DAILY_CAP') ?? 300);
const CATS = ['violence', 'scariness', 'language', 'sexual_content', 'mature_themes', 'lgbtq_themes'] as const;

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

async function tmdb(path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${Deno.env.get('TMDB_READ_TOKEN')}` } });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return await res.json();
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function count(since: Date, kind?: string, ipHash?: string) {
  let q = db.from('lookup_log').select('id', { count: 'exact', head: true }).gte('created_at', since.toISOString());
  if (kind) q = q.eq('kind', kind);
  if (ipHash) q = q.eq('ip_hash', ipHash);
  const { count: n, error } = await q;
  if (error) throw new Error(error.message);
  return n ?? 0;
}

async function callLLM(prompt: string) {
  const res = await fetch(`${Deno.env.get('LLM_BASE_URL')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${Deno.env.get('LLM_API_KEY')}` },
    body: JSON.stringify({
      model: Deno.env.get('LLM_MODEL'),
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}`);
  const j = await res.json();
  return JSON.parse(j.choices[0].message.content);
}

async function search(query: string) {
  const r = await tmdb('/search/movie', { query, include_adult: 'false' });
  const hits = (r.results as any[]).filter((m) => m.overview && m.poster_path).slice(0, 8);
  const { data } = await db.from('movies').select('tmdb_id').in('tmdb_id', hits.map((m) => m.id)).eq('is_published', true);
  const ready = new Set((data ?? []).map((d) => d.tmdb_id));
  return hits.map((m) => ({
    tmdb_id: m.id, title: m.title, year: m.release_date?.slice(0, 4) ?? null,
    poster_path: m.poster_path, overview: m.overview, ready: ready.has(m.id),
  }));
}

async function add(tmdbId: number) {
  const m = await tmdb(`/movie/${tmdbId}`, { append_to_response: 'keywords,watch/providers' });
  if (m.adult) return json({ error: 'Adult-only titles are not supported.' }, 422);
  if (!m.overview) return json({ error: 'TMDB has no synopsis for this title, so it cannot be reviewed.' }, 422);

  const audience = m.genres.some((g: any) => g.id === 10751) ? 'kids' : 'adults';
  const { data: row, error } = await db.from('movies').upsert({
    tmdb_id: m.id, imdb_id: m.imdb_id, title: m.title, original_title: m.original_title,
    release_year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
    runtime_min: m.runtime, overview: m.overview, poster_path: m.poster_path, backdrop_path: m.backdrop_path,
    original_language: m.original_language, tmdb_vote_avg: Math.round(m.vote_average * 10) / 10,
    tmdb_genres: m.genres.map((g: any) => g.name), audience,
    origin_countries: m.production_countries.map((c: any) => c.iso_3166_1),
    spoken_languages: m.spoken_languages.map((l: any) => l.iso_639_1),
    is_black_and_white: !!m.keywords?.keywords?.some((k: any) => k.name.toLowerCase() === 'black and white'),
  }, { onConflict: 'tmdb_id', ignoreDuplicates: true }).select('id,review_status,is_published').maybeSingle();
  if (error) throw new Error(error.message);

  let movieId = row?.id as number | undefined;
  if (!movieId) {
    const { data: ex } = await db.from('movies').select('id,is_published').eq('tmdb_id', m.id).single();
    if (ex?.is_published) return json({ tmdb_id: m.id, status: 'ready' });
    movieId = ex!.id;
  }

  // Availability for all configured countries (flatrate/free/ads only).
  const now = new Date().toISOString();
  const providers = new Map<number, object>();
  const cache: object[] = [];
  for (const country of COUNTRIES) {
    const region = m['watch/providers']?.results?.[country];
    for (const type of TYPES) {
      for (const p of region?.[type] ?? []) {
        providers.set(p.provider_id, { provider_id: p.provider_id, name: p.provider_name, logo_path: p.logo_path });
        cache.push({ movie_id: movieId, country_code: country, provider_id: p.provider_id, monetization_type: type, deep_link: region?.link ?? null, fetched_at: now });
      }
    }
  }
  if (providers.size) await db.from('streaming_providers').upsert([...providers.values()], { onConflict: 'provider_id' });
  await db.from('streaming_cache').delete().eq('movie_id', movieId);
  if (cache.length) await db.from('streaming_cache').insert(cache);

  const t = Tag.parse(await callLLM(fillPrompt({
    title: m.title, year: String(m.release_date?.slice(0, 4) ?? ''), tmdb_id: String(m.id), audience,
    language: m.original_language ?? 'unknown', overview: m.overview, parents_guide: '(none provided)',
  })));
  if (t.tmdb_id !== m.id) throw new Error('tmdb_id mismatch');

  const { data: valueRows } = await db.from('inspirational_values').select('id,slug');
  const valueId = new Map((valueRows ?? []).map((v) => [v.slug, v.id]));
  const cw = await db.from('content_warnings').upsert({
    movie_id: movieId, ...Object.fromEntries(CATS.map((c) => [c, t[c]])),
    notes: t.notes, source: 'llm', confidence: t.confidence,
    tagged_by: Deno.env.get('LLM_MODEL'), tagged_at: now,
  });
  if (cw.error) throw new Error(cw.error.message);
  await db.from('movie_values').delete().eq('movie_id', movieId);
  if (t.values.length) {
    await db.from('movie_values').insert(t.values.map((v) => ({ movie_id: movieId, value_id: valueId.get(v.slug), strength: v.strength })));
  }
  const up = await db.from('movies').update({
    takeaway: t.takeaway, advisory: t.advisory, recommended_min_age: t.recommended_min_age,
    review_status: 'ai_reviewed', is_published: true,
  }).eq('id', movieId);
  if (up.error) throw new Error(up.error.message);
  return json({ tmdb_id: m.id, status: 'added' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
    const ipHash = await sha256(`akira:${ip}`);
    const hourAgo = new Date(Date.now() - 3600_000);

    if (typeof body.query === 'string') {
      const q = body.query.trim().slice(0, 100);
      if (q.length < 2) return json({ results: [] });
      if (await count(hourAgo, 'search', ipHash) >= SEARCH_PER_HOUR) return json({ error: 'Too many searches. Try again later.' }, 429);
      await db.from('lookup_log').insert({ ip_hash: ipHash, kind: 'search' });
      return json({ results: await search(q) });
    }

    const tmdbId = Number(body.tmdb_id);
    if (Number.isInteger(tmdbId) && tmdbId > 0) {
      if (await count(hourAgo, 'add', ipHash) >= ADD_PER_HOUR) return json({ error: 'Too many additions from your network. Try again later.' }, 429);
      if (await count(new Date(Date.now() - 86_400_000), 'add') >= DAILY_CAP) return json({ error: 'Daily limit for new reviews reached. Try again tomorrow.' }, 429);
      await db.from('lookup_log').insert({ ip_hash: ipHash, kind: 'add', tmdb_id: tmdbId });
      return await add(tmdbId);
    }
    return json({ error: 'Send { query } or { tmdb_id }.' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: 'Lookup failed. Please try again.' }, 500);
  }
});
