// On-demand lookup: search TMDB, or add one film (metadata + availability + single-LLM tagging) and
// publish it as 'ai_reviewed'. Deploy: supabase functions deploy lookup --no-verify-jwt
// Secrets: TMDB_READ_TOKEN, LLM_BASE_URL, LLM_API_KEY, LLM_MODEL, optional ONDEMAND_DAILY_CAP
import { createClient } from '@supabase/supabase-js';
import { Tag, fillPrompt } from '../_shared/tagging.ts';

const TYPES = ['flatrate', 'free', 'ads'];
const SEARCH_PER_HOUR = 30;
const ADD_PER_HOUR = 8;
const DAILY_CAP = Number(Deno.env.get('ONDEMAND_DAILY_CAP') ?? 300);

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
  let token = Deno.env.get('TMDB_READ_TOKEN')?.trim() ?? '';
  if (!token) throw new Error('TMDB_READ_TOKEN secret is not configured in Supabase Edge Functions.');
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    token = token.slice(1, -1).trim();
  }
  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7).trim();
  }

  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  // Try Bearer token if it looks like a v4 JWT (starts with eyJ)
  if (token.startsWith('eyJ')) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (res.ok) return await res.json();
    // If Bearer failed, also try query parameter as fallback
    const fallbackUrl = new URL(url.toString());
    fallbackUrl.searchParams.set('api_key', token);
    const retry = await fetch(fallbackUrl, { headers: { Accept: 'application/json' } });
    if (retry.ok) return await retry.json();
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`TMDB error (${res.status}): ${body} (Token length: ${token.length}, type: v4 JWT).`);
  } else {
    // Otherwise treat as v3 API Key (?api_key=...)
    url.searchParams.set('api_key', token);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) return await res.json();
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`TMDB error (${res.status}): ${body} (Token length: ${token.length}. Note: TMDB v4 Read Access Tokens start with "eyJ" and are ~200+ characters).`);
  }
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
  const hits = (r.results as any[]).filter((m) => m.overview && m.poster_path);
  if (!hits.length) return [];
  const { data, error } = await db.from('movies').select('tmdb_id').in('tmdb_id', hits.map((m) => m.id)).eq('is_published', true);
  if (error) throw error;
  const ready = new Set((data ?? []).map((d) => d.tmdb_id));
  return hits.filter((m) => !ready.has(m.id)).slice(0, 8).map((m) => ({
    tmdb_id: m.id, title: m.title, year: m.release_date?.slice(0, 4) ?? null,
    poster_path: m.poster_path, overview: m.overview, ready: ready.has(m.id),
  }));
}

async function add(tmdbId: number) {
  const m = await tmdb(`/movie/${tmdbId}`, { append_to_response: 'keywords,watch/providers' });
  if (m.adult) return json({ error: 'Adult-only titles are not supported.' }, 422);
  if (!m.overview) return json({ error: 'TMDB has no synopsis for this title, so it cannot be reviewed.' }, 422);

  let audience = m.genres.some((g: any) => g.id === 10751) ? 'kids' : 'adults';
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
    const { data: ex, error: existingError } = await db.from('movies').select('id,is_published,review_status,audience').eq('tmdb_id', m.id).single();
    if (existingError) throw existingError;
    if (ex?.is_published) return json({ tmdb_id: m.id, status: 'ready' });
    if (ex.review_status !== 'draft') return json({ error: 'This title requires manual review.' }, 409);
    movieId = ex.id;
    audience = ex.audience;
  }

  // Availability for all TMDB regions (flatrate/free/ads only).
  if (!m['watch/providers']?.results) throw new Error('TMDB did not return availability');
  const now = new Date().toISOString();
  const providers = new Map<number, object>();
  const cache: object[] = [];
  for (const country of Object.keys(m['watch/providers']?.results ?? {})) {
    const region = m['watch/providers']?.results?.[country];
    for (const type of TYPES) {
      for (const p of region?.[type] ?? []) {
        providers.set(p.provider_id, { provider_id: p.provider_id, name: p.provider_name, logo_path: p.logo_path });
        cache.push({ movie_id: movieId, country_code: country, provider_id: p.provider_id, monetization_type: type, deep_link: region?.link ?? null, fetched_at: now });
      }
    }
  }
  if (providers.size) {
    const { error: e } = await db.from('streaming_providers').upsert([...providers.values()], { onConflict: 'provider_id' });
    if (e) throw e;
  }
  const { error: availabilityError } = await db.rpc('replace_movie_availability', { p_movie_id: movieId, p_offers: cache });
  if (availabilityError) throw availabilityError;

  const t = Tag.parse(await callLLM(fillPrompt({
    title: m.title, year: String(m.release_date?.slice(0, 4) ?? ''), tmdb_id: String(m.id), audience,
    language: m.original_language ?? 'unknown', overview: m.overview, parents_guide: '(none provided)',
  })));
  if (t.tmdb_id !== m.id) throw new Error('tmdb_id mismatch');

  const { error: tagError } = await db.rpc('complete_movie_tagging', {
    p_movie_id: movieId, p_tag: t, p_model: Deno.env.get('LLM_MODEL'),
  });
  if (tagError) throw tagError;
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
      const { error } = await db.from('lookup_log').insert({ ip_hash: ipHash, kind: 'search' });
      if (error) throw error;
      return json({ results: await search(q) });
    }

    const tmdbId = Number(body.tmdb_id);
    if (Number.isInteger(tmdbId) && tmdbId > 0) {
      if (await count(hourAgo, 'add', ipHash) >= ADD_PER_HOUR) return json({ error: 'Too many additions from your network. Try again later.' }, 429);
      if (await count(new Date(Date.now() - 86_400_000), 'add') >= DAILY_CAP) return json({ error: 'Daily limit for new reviews reached. Try again tomorrow.' }, 429);
      const { error } = await db.from('lookup_log').insert({ ip_hash: ipHash, kind: 'add', tmdb_id: tmdbId });
      if (error) throw error;
      return await add(tmdbId);
    }
    return json({ error: 'Send { query } or { tmdb_id }.' }, 400);
  } catch (e) {
    console.error(e);
    const msg = (e as Error)?.message || 'Lookup failed. Please try again.';
    return json({ error: msg }, 500);
  }
});
