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
    'refresh-oldest': { type: 'string' },
  },
});

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

// Parallel jobs touch the same provider rows; retry if Postgres picks us as the deadlock victim.
async function retry<T>(fn: () => PromiseLike<T>, tries = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries || !/deadlock|could not serialize/i.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 300 * i + Math.random() * 500));
    }
  }
}

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
  const providers = new Map<number, { provider_id: number; name: string; logo_path: string | null }>();
  const rows = new Map<number, Map<string, object>>();
  const now = new Date().toISOString();
  for (const m of movies) {
    const movieId = idByTmdb.get(m.id);
    if (!movieId) continue;
    if (!m['watch/providers']?.results) throw new Error(`TMDB did not return availability for ${m.id}`);
    rows.set(movieId, new Map());
    for (const country of Object.keys(m['watch/providers'].results)) {
      const region = m['watch/providers']?.results?.[country];
      for (const type of TYPES) {
        for (const p of region?.[type] ?? []) {
          providers.set(p.provider_id, { provider_id: p.provider_id, name: p.provider_name, logo_path: p.logo_path });
          rows.get(movieId)!.set(`${country}|${p.provider_id}|${type}`, {
            movie_id: movieId, country_code: country, provider_id: p.provider_id,
            monetization_type: type, deep_link: region?.link ?? null, fetched_at: now,
          });
        }
      }
    }
  }
  if (providers.size) {
    const sorted = [...providers.values()].sort((x, y) => x.provider_id - y.provider_id);
    await retry(async () => must(await db.from('streaming_providers').upsert(sorted, { onConflict: 'provider_id' })));
  }
  let total = 0;
  for (const [movieId, offers] of rows) {
    const list = [...offers.values()];
    await retry(async () => must(await db.rpc('replace_movie_availability', { p_movie_id: movieId, p_offers: list })));
    total += list.length;
  }
  return total;
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
  const saved = must(await db.from('movies').select('id,tmdb_id').in('tmdb_id', movies.map((m) => m.id)));
  await saveAvailability(movies, new Map((saved ?? []).map((r) => [r.tmdb_id, r.id])));
  if (saved?.length) must(await db.from('movies').update({ updated_at: new Date().toISOString() }).in('id', saved.map((r) => r.id)));
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
  console.log(`Refreshing availability for ${rows.length} films in all TMDB regions...`);
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
