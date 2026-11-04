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
export async function tmdb<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const token = process.env.TMDB_READ_TOKEN;
  if (!token) throw new Error('TMDB_READ_TOKEN missing');
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = Math.max(0, last + 60 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
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

export const getMovie = (id: number) => tmdb<TmdbMovie>(`/movie/${id}`);

export async function getWatchProviders(id: number, country: string): Promise<TmdbRegionProviders | null> {
  const r = await tmdb<{ results: Record<string, TmdbRegionProviders> }>(`/movie/${id}/watch/providers`);
  return r.results[country] ?? null;
}

/** Discover family movies already streaming in a region on given providers. */
export async function discoverFamilyIds(opts: {
  country: string;
  providers: number[];
  pages: number;
  language?: string;
}): Promise<number[]> {
  const ids = new Set<number>();
  for (let page = 1; page <= opts.pages; page++) {
    const r = await tmdb<{ results: { id: number }[]; total_pages: number }>('/discover/movie', {
      with_genres: '10751', // Family
      watch_region: opts.country,
      with_watch_providers: opts.providers.join('|'),
      with_watch_monetization_types: 'flatrate|free|ads',
      sort_by: 'popularity.desc',
      include_adult: 'false',
      page,
      ...(opts.language ? { with_original_language: opts.language } : {}),
    });
    r.results.forEach((m) => ids.add(m.id));
    if (page >= r.total_pages) break;
  }
  return [...ids];
}
