/**
 * Global catalogue ingest: every movie TMDB knows with enough votes, no country/audience/provider filter.
 * Availability for all configured countries comes from the same single TMDB request per film.
 *
 *   npm run ingest:global -- --year-from 2020 --year-to 2024            (new films only; safe to re-run / resume)
 *   npm run ingest:global -- --year-from 1950 --year-to 1950 --min-votes 20
 *   npm run ingest:global -- --refresh-oldest 15000                      (re-sync availability of the stalest films)
 *
 * New films are stored as unpublished drafts (audience: Family genre = kids, otherwise adults) and become
 * visible after tagging (scripts/tag-movies.ts) or an on-demand lookup. Runs offline / in GitHub Actions.
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { discoverYear, getMovieFull, type TmdbMovieFull } from './lib/tmdb.js';

const { values: a } = parseArgs({
  options: {
    'year-from': { type: 'string' },
    'year-to': { type: 'string' },
    'min-votes': { type: 'string', default: '50' },
    countries: { type: 'string', default: 'IN,US,GB,CA,AU,AE' }, // keep aligned with COUNTRIES in lib/constants.ts
    'refresh-oldest': { type: 'string' },
  },
});

const COUNTRIES = a.countries!.split(',').map((c) => c.trim().toUpperCase());
const TYPES = ['flatrate', 'free', 'ads'] as const; // rent/buy are not used by discovery; skipping them saves space
const BATCH = 20;
const FAMILY = 10751;
const MAX_TMDB_PAGES = 500; // TMDB discover hard limit
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const must = <T>(r: { data: T; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

async function fetchDetails(ids: number[]): Promise<TmdbMovieFull[]> {
  const settled = await Promise.allSettled(ids.map(getMovieFull));
  const out: TmdbMovieFull[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') out.push(s.value);
    else { failed++; console.error(`✗ tmdb:${ids[i]}`, (s.reason as Error).message); }
  });
  return out;
}

async function saveAvailability(movies: TmdbMovieFull[], idByTmdb: Map<number, number>) {
  const movieIds = movies.map((m) => idByTmdb.get(m.id)!).filter(Boolean);
  const providers = new Map<number, { provider_id: number; name: string; logo_path: string | null }>();
  const rows = new Map<string, object>();
  const now = new Date().toISOString();
  for (const m of movies) {
    const movieId = idByTmdb.get(m.id);
    if (!movieId) continue;
    for (const country of COUNTRIES) {
      const region = m['watch/providers']?.results?.[country];
      for (const type of TYPES) {
        for (const p of region?.[type] ?? []) {
          providers.set(p.provider_id, { provider_id: p.provider_id, name: p.provider_name, logo_path: p.logo_path });
          rows.set(`${movieId}|${country}|${p.provider_id}|${type}`, {
            movie_id: movieId, country_code: country, provider_id: p.provider_id,
            monetization_type: type, deep_link: region?.link ?? null, fetched_at: now,
          });
        }
      }
    }
  }
  if (providers.size) must(await db.from('streaming_providers').upsert([...providers.values()], { onConflict: 'provider_id' }));
  must(await db.from('streaming_cache').delete().in('movie_id', movieIds).in('country_code', COUNTRIES));
  const list = [...rows.values()];
  for (let i = 0; i < list.length; i += 1000) must(await db.from('streaming_cache').insert(list.slice(i, i + 1000)));
  return list.length;
}

/** New films: insert metadata as drafts, then availability. */
async function addBatch(ids: number[]) {
  const movies = await fetchDetails(ids);
  if (!movies.length) return 0;
  const saved = must(
    await db.from('movies').upsert(
      movies.map((m) => ({
        tmdb_id: m.id, imdb_id: m.imdb_id, title: m.title, original_title: m.original_title,
        release_year: m.release_date ? Number(m.release_date.slice(0, 4)) : null,
        runtime_min: m.runtime, overview: m.overview, poster_path: m.poster_path, backdrop_path: m.backdrop_path,
        original_language: m.original_language, tmdb_vote_avg: Math.round(m.vote_average * 10) / 10,
        tmdb_genres: m.genres.map((g) => g.name),
        audience: m.genres.some((g) => g.id === FAMILY) ? 'kids' : 'adults',
        origin_countries: m.production_countries.map((c) => c.iso_3166_1),
        spoken_languages: m.spoken_languages.map((l) => l.iso_639_1),
        is_black_and_white: !!m.keywords?.keywords.some((k) => k.name.toLowerCase() === 'black and white'),
      })),
      { onConflict: 'tmdb_id', ignoreDuplicates: true },
    ).select('id,tmdb_id'),
  );
  await saveAvailability(movies, new Map((saved ?? []).map((r) => [r.tmdb_id, r.id])));
  return saved?.length ?? 0;
}

/** Existing films: touch updated_at (marks them fresh) and replace availability. */
async function refreshBatch(ids: number[]) {
  const movies = await fetchDetails(ids);
  if (!movies.length) return 0;
  const saved = must(
    await db.from('movies').upsert(
      movies.map((m) => ({ tmdb_id: m.id, title: m.title, tmdb_vote_avg: Math.round(m.vote_average * 10) / 10 })),
      { onConflict: 'tmdb_id' },
    ).select('id,tmdb_id'),
  );
  await saveAvailability(movies, new Map((saved ?? []).map((r) => [r.tmdb_id, r.id])));
  return saved?.length ?? 0;
}

async function pageAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, max = Infinity) {
  const out: T[] = [];
  for (let from = 0; out.length < max; from += 1000) {
    const rows = must(await query(from, from + 999)) ?? [];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out.slice(0, max);
}

let failed = 0;
let added = 0;

if (a['refresh-oldest']) {
  const n = Number(a['refresh-oldest']);
  const rows = await pageAll<{ tmdb_id: number }>(
    (from, to) => db.from('movies').select('tmdb_id').eq('is_published', true).order('updated_at').order('id').range(from, to), n,
  );
  console.log(`Refreshing availability for ${rows.length} films (${COUNTRIES.join(', ')})...`);
  for (let i = 0; i < rows.length; i += BATCH) {
    added += await refreshBatch(rows.slice(i, i + BATCH).map((r) => r.tmdb_id));
    if ((i / BATCH) % 25 === 0) console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
} else {
  if (!a['year-from'] || !a['year-to']) throw new Error('Pass --year-from and --year-to (or --refresh-oldest N).');
  const minVotes = Number(a['min-votes']);
  for (let year = Number(a['year-from']); year <= Number(a['year-to']); year++) {
    const have = new Set((await pageAll<{ tmdb_id: number }>(
      (from, to) => db.from('movies').select('tmdb_id').eq('release_year', year).order('id').range(from, to),
    )).map((r) => r.tmdb_id));
    let yearAdded = 0;
    for (let page = 1; page <= MAX_TMDB_PAGES; page++) {
      const r = await discoverYear(year, page, minVotes);
      const fresh = r.results.filter((m) => m.poster_path && m.overview && !have.has(m.id)).map((m) => m.id);
      for (let i = 0; i < fresh.length; i += BATCH) yearAdded += await addBatch(fresh.slice(i, i + BATCH));
      if (page >= r.total_pages) break;
    }
    added += yearAdded;
    console.log(`${year}: +${yearAdded} new (had ${have.size})`);
  }
}

console.log(`Done: ${added} films written; ${failed} failed`);
if (failed > 0) process.exitCode = 1;
