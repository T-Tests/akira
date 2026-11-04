import seed from '@/data/seed.json';
import { supabase } from './discover';
import type { MovieResult, TmdbCandidate } from './types';

/** Search films already in the database (published only). */
export async function searchLibrary(query: string, country: string): Promise<MovieResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (supabase) {
    const { data, error } = await supabase.rpc('search_movies', { p_query: q, p_country: country, p_limit: 12 });
    if (error) throw error;
    return data as MovieResult[];
  }
  const names = new Map(seed.providers.map((p) => [p.provider_id, p.name]));
  return seed.movies
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.title.toLowerCase().includes(q.toLowerCase()))
    .map(({ m, i }) => ({
      id: i + 1, tmdb_id: m.tmdb_id, title: m.title, release_year: m.release_year, runtime_min: m.runtime_min,
      poster_path: m.poster_path, takeaway: m.takeaway, advisory: m.advisory, recommended_min_age: m.recommended_min_age,
      ...(m.content as any),
      value_slugs: m.values.map((v) => v.slug),
      providers: ((m.streaming as Record<string, { provider_id: number; type: string }[]>)[country] ?? []).map((o) => ({
        provider_id: o.provider_id, name: names.get(o.provider_id) ?? String(o.provider_id), type: o.type,
        link: `https://www.themoviedb.org/movie/${m.tmdb_id}/watch?locale=${country}`,
      })),
      original_language: m.original_language, origin_countries: m.origin_countries,
      is_black_and_white: m.is_black_and_white, subtitle_languages: m.subtitle_languages,
      audience: m.audience, value_match_score: 0,
    })) as MovieResult[];
}

async function invoke<T>(body: object): Promise<T> {
  if (!supabase) throw new Error('Searching TMDB needs a connected Supabase project.');
  const { data, error } = await supabase.functions.invoke('lookup', { body });
  if (error) {
    const res = (error as { context?: Response }).context;
    const msg = res ? (await res.json().catch(() => null))?.error : null;
    throw new Error(msg ?? 'Lookup failed. Please try again.');
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export const searchTmdb = (query: string) => invoke<{ results: TmdbCandidate[] }>({ query }).then((r) => r.results);
export const addFromTmdb = (tmdb_id: number) => invoke<{ status: string }>({ tmdb_id });
