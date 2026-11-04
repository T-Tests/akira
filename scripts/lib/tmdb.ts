import 'dotenv/config';

const BASE = 'https://api.themoviedb.org/3';

export interface TmdbMovie {
  id: number;
  imdb_id: string | null;
  title: string;
  original_title: string;
  release_date: string;
  runtime: number | null;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  original_language: string;
  vote_average: number;
  genres: { id: number; name: string }[];
  production_countries: { iso_3166_1: string }[];
  spoken_languages: { iso_639_1: string }[];
  keywords?: { keywords: { id: number; name: string }[] };
}

export interface TmdbProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
}

export interface TmdbRegionProviders {
  link?: string; // TMDB/JustWatch landing page for this movie+region
  flatrate?: TmdbProvider[];
  free?: TmdbProvider[];
  ads?: TmdbProvider[];
  rent?: TmdbProvider[];
  buy?: TmdbProvider[];
}

// Simple spacing to stay under TMDB's ~40 req/s soft limit; retries on 429/5xx.
let last = 0;
let rateQueue: Promise<void> = Promise.resolve();

async function waitForRateLimit() {
  const previous = rateQueue;
  let release!: () => void;
  rateQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const wait = Math.max(0, last + 60 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  release();
}

export async function tmdb<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) throw new Error('TMDB_READ_TOKEN missing');
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  for (let attempt = 0; attempt < 4; attempt++) {
    await waitForRateLimit();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      const retry = Number(res.headers.get('retry-after') ?? 2 ** attempt);
      await new Promise((r) => setTimeout(r, retry * 1000));
      continue;
    }
    throw new Error(`TMDB ${res.status} ${path}: ${await res.text()}`);
  }
  throw new Error(`TMDB retries exhausted: ${path}`);
}

export const getMovie = (id: number) => tmdb<TmdbMovie>(`/movie/${id}`, { append_to_response: 'keywords' });

/** Details + keywords + watch providers for every region in ONE request. */
export interface TmdbMovieFull extends TmdbMovie {
  'watch/providers'?: { results: Record<string, TmdbRegionProviders> };
}
export const getMovieFull = (id: number) =>
  tmdb<TmdbMovieFull>(`/movie/${id}`, { append_to_response: 'keywords,watch/providers' });

export interface DiscoverRow { id: number; poster_path: string | null; overview: string; genre_ids: number[] }

/** One page of every movie released in `year` with at least `minVotes` votes (no region/provider filter). */
export const discoverYear = (year: number, page: number, minVotes: number) =>
  tmdb<{ results: DiscoverRow[]; total_pages: number }>('/discover/movie', {
    include_adult: 'false',
    sort_by: 'vote_count.desc',
    'vote_count.gte': minVotes,
    'primary_release_date.gte': `${year}-01-01`,
    'primary_release_date.lte': `${year}-12-31`,
    page,
  });

export async function findKeywordId(name: string): Promise<number | null> {
  const r = await tmdb<{ results: { id: number; name: string }[] }>('/search/keyword', { query: name });
  return r.results.find((k) => k.name.toLowerCase() === name.toLowerCase())?.id ?? null;
}

export async function getWatchProviders(id: number, country: string): Promise<TmdbRegionProviders | null> {
  const r = await tmdb<{ results: Record<string, TmdbRegionProviders> }>(`/movie/${id}/watch/providers`);
  return r.results[country] ?? null;
}

export interface DiscoverOpts {
  country: string;
  providers: number[];
  pages: number;
  audience: 'kids' | 'adults';
  language?: string;      // original language, ISO 639-1
  keywordId?: number;     // e.g. "black and white"
  yearMin?: number;
  yearMax?: number;
  minVotes?: number;
}

/** Discover movies streaming in a region. Kids = Family genre; adults = everything else, best-rated first. */
export async function discoverIds(o: DiscoverOpts): Promise<number[]> {
  const ids = new Set<number>();
  for (let page = 1; page <= o.pages; page++) {
    const params: Record<string, string | number> = {
      watch_region: o.country,
      with_watch_providers: o.providers.join('|'),
      with_watch_monetization_types: 'flatrate|free|ads',
      include_adult: 'false',
      page,
    };
    if (o.audience === 'kids') {
      params.with_genres = '10751'; // Family
      params.sort_by = 'popularity.desc';
    } else {
      params.without_genres = '10751';
      params.sort_by = 'vote_average.desc';
      params['vote_count.gte'] = o.minVotes ?? 300; // avoids obscure, barely-rated titles
    }
    if (o.language) params.with_original_language = o.language;
    if (o.keywordId) params.with_keywords = o.keywordId;
    if (o.yearMin) params['primary_release_date.gte'] = `${o.yearMin}-01-01`;
    if (o.yearMax) params['primary_release_date.lte'] = `${o.yearMax}-12-31`;
    const r = await tmdb<{ results: { id: number }[]; total_pages: number }>('/discover/movie', params);
    r.results.forEach((m) => ids.add(m.id));
    if (page >= r.total_pages) break;
  }
  return [...ids];
}
