/**
 * Usage:
 *   npm run ingest -- --country IN --providers 8,119,122 --pages 3
 *   npm run ingest -- --country US --ids 862,10191        (specific TMDB ids)
 *   npm run ingest -- --country IN --refresh-stale        (re-sync availability >7d old)
 *   npm run ingest -- --country US --audience adults --bw --year-max 1969 --providers 258,11,1899
 *   npm run ingest -- --country IN --audience adults --language ja --pages 3
 *   npm run ingest -- --country US --audience adults --world-cinema --pages 3
 *   npm run ingest -- --country US --refresh-all
 *
 * Upserts movie metadata (never touches curated columns: takeaway/advisory/age/is_published)
 * and fully replaces streaming_cache rows for (movie, country).
 * Runs offline / in GitHub Actions - NOT on Cloudflare Workers.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { discoverIds, findKeywordId, getMovie, getWatchProviders } from './lib/tmdb.js';

const { values: a } = parseArgs({
  options: {
    country: { type: 'string', default: 'US' },
    providers: { type: 'string', default: '8,119,122,337,350' }, // Netflix, Prime, Hotstar, Disney+, Apple TV+
    pages: { type: 'string', default: '2' },
    ids: { type: 'string' },
    audience: { type: 'string', default: 'kids' }, // kids | adults
    language: { type: 'string' },                  // original language, e.g. ja, fr, hi
    bw: { type: 'boolean', default: false },       // only TMDB "black and white" keyword
    'year-min': { type: 'string' },
    'year-max': { type: 'string' },
    'min-votes': { type: 'string' },
    'refresh-stale': { type: 'boolean', default: false },
    'refresh-all': { type: 'boolean', default: false },
    'world-cinema': { type: 'boolean', default: false },
  },
});

const country = a.country!.toUpperCase();
if (a.audience !== 'kids' && a.audience !== 'adults') {
  throw new Error(`Unsupported audience "${a.audience}"; use "kids" or "adults".`);
}
const audience: 'kids' | 'adults' = a.audience;
const providerIds = a.providers!.split(',').map(Number);
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const TYPES = ['flatrate', 'free', 'ads', 'rent', 'buy'] as const;

async function resolveIds(): Promise<number[]> {
  if (a.ids) return a.ids.split(',').map(Number);
  if (a['refresh-all']) {
    const ids: number[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await db.from('movies').select('tmdb_id').order('id').range(from, from + pageSize - 1);
      if (error) throw error;
      ids.push(...data.map((r) => r.tmdb_id));
      if (data.length < pageSize) break;
    }
    return ids;
  }
  if (a['refresh-stale']) {
    const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data, error } = await db
      .from('streaming_cache')
      .select('movies!inner(tmdb_id)')
      .eq('country_code', country)
      .lt('fetched_at', cutoff);
    if (error) throw error;
    return [...new Set((data as any[]).map((r) => r.movies.tmdb_id as number))];
  }
  const keywordId = a.bw ? await findKeywordId('black and white') : undefined;
  if (a.bw && !keywordId) throw new Error('TMDB keyword "black and white" not found');
  const opts = {
    country, providers: providerIds, pages: Number(a.pages), audience,
    language: a.language, keywordId: keywordId ?? undefined,
    yearMin: a['year-min'] ? Number(a['year-min']) : undefined,
    yearMax: a['year-max'] ? Number(a['year-max']) : undefined,
    minVotes: a['min-votes'] ? Number(a['min-votes']) : undefined,
  };
  const ids = await discoverIds(opts);
  if (a['world-cinema']) {
    if (audience !== 'adults') throw new Error('--world-cinema requires --audience adults');
    const languages = ['ja', 'ko', 'hi', 'bn', 'ta', 'te', 'ml', 'mr', 'zh', 'fr', 'es', 'it', 'de', 'pt', 'ru', 'ar', 'fa', 'tr', 'th', 'id'];
    const [bwKeywordId] = await Promise.all([findKeywordId('black and white')]);
    if (!bwKeywordId) throw new Error('TMDB keyword "black and white" not found');
    const additional = await Promise.all([
      discoverIds({ ...opts, pages: 2, keywordId: bwKeywordId }),
      ...languages.map((language) => discoverIds({ ...opts, language, pages: 1 })),
    ]);
    additional.forEach((batch) => batch.forEach((id) => ids.push(id)));
  }
  return [...new Set(ids)];
}

async function syncOne(tmdbId: number) {
  const [m, prov] = await Promise.all([getMovie(tmdbId), getWatchProviders(tmdbId, country)]);

  // A film ingested as both kids and adults becomes 'both'; curated 'both' is never downgraded.
  const existing = await db.from('movies').select('audience').eq('tmdb_id', m.id).maybeSingle();
  const merged = a['refresh-all'] && existing.data
    ? existing.data.audience
    : existing.data && existing.data.audience !== audience ? 'both' : audience;
  const isBw = m.keywords?.keywords.some((k) => k.name.toLowerCase() === 'black and white');

  const { data: row, error } = await db
    .from('movies')
    .upsert(
      {
        audience: merged,
        origin_countries: m.production_countries.map((c) => c.iso_3166_1),
        spoken_languages: m.spoken_languages.map((l) => l.iso_639_1),
        ...(isBw ? { is_black_and_white: true } : {}), // never un-flag a curated value

        tmdb_id: m.id,
        imdb_id: m.imdb_id,
        title: m.title,
        original_title: m.original_title,
        release_year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
        runtime_min: m.runtime,
        overview: m.overview,
        poster_path: m.poster_path,
        backdrop_path: m.backdrop_path,
        original_language: m.original_language,
        tmdb_vote_avg: Math.round(m.vote_average * 10) / 10,
        tmdb_genres: m.genres.map((g) => g.name),
      },
      { onConflict: 'tmdb_id' },
    )
    .select('id')
    .single();
  if (error) throw error;

  // Replace availability for this movie+country atomically enough for a cache.
  const rows: any[] = [];
  const provs: any[] = [];
  for (const type of TYPES) {
    for (const p of prov?.[type] ?? []) {
      provs.push({ provider_id: p.provider_id, name: p.provider_name, logo_path: p.logo_path });
      rows.push({
        movie_id: row.id,
        country_code: country,
        provider_id: p.provider_id,
        monetization_type: type,
        deep_link: prov?.link ?? null,
        fetched_at: new Date().toISOString(),
      });
    }
  }
  if (provs.length) {
    const uniq = [...new Map(provs.map((p) => [p.provider_id, p])).values()];
    const r = await db.from('streaming_providers').upsert(uniq, { onConflict: 'provider_id' });
    if (r.error) throw r.error;
  }
  const del = await db.from('streaming_cache').delete().eq('movie_id', row.id).eq('country_code', country);
  if (del.error) throw del.error;
  if (rows.length) {
    const ins = await db.from('streaming_cache').insert(rows);
    if (ins.error) throw ins.error;
  }
  return { title: m.title, offers: rows.length };
}

const ids = await resolveIds();
console.log(`Syncing ${ids.length} movies for ${country}...`);
let ok = 0;
let failed = 0;
for (const id of ids) {
  try {
    const r = await syncOne(id);
    ok++;
    console.log(`✓ ${r.title} (${r.offers} offers)`);
  } catch (e) {
    failed++;
    console.error(`✗ tmdb:${id}`, (e as Error).message);
  }
}
console.log(`Done: ${ok}/${ids.length}; failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
