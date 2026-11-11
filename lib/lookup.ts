import seed from '@/data/seed.json';
import { supabase } from './discover';
import { dedupeProviders, getOttWatchUrl } from './constants';
import type { Audience, MovieResult, TmdbCandidate } from './types';

/** Search films already in the database (published only). */
export async function searchLibrary(query: string, audience: Audience, userProviders?: number[]): Promise<MovieResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  if (supabase) {
    // Search across published catalogue so movies in review or other audiences are found
    const { data, error } = await supabase.rpc('search_movies_for_audience', { p_query: q, p_audience: 'adults', p_limit: 12 });
    if (error) throw error;
    return ((data as MovieResult[]) || []).map((m) => ({
      ...m,
      providers: dedupeProviders(m.providers, userProviders),
    }));
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
      providers: dedupeProviders(Object.entries(m.streaming as Record<string, { provider_id: number; type: string }[]>)
        .flatMap(([country, offers]) => offers.map((o) => ({
          provider_id: o.provider_id, name: names.get(o.provider_id) ?? String(o.provider_id), type: o.type, country,
          link: getOttWatchUrl(o.provider_id, names.get(o.provider_id) ?? String(o.provider_id), m.title),
        }))), userProviders),
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
    let msg: string | null = null;
    if (res) {
      try {
        const j = await res.json();
        msg = j?.error ?? null;
      } catch {
        try {
          msg = await res.text();
        } catch {}
      }
    }
    throw new Error(msg || error.message || 'Lookup failed. Please check TMDB_READ_TOKEN configuration.');
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}

async function searchTmdbDirect(query: string): Promise<TmdbCandidate[]> {
  const token = process.env.NEXT_PUBLIC_TMDB_READ_TOKEN || process.env.TMDB_READ_TOKEN;
  if (!token) {
    throw new Error('TMDB search failed. Please ensure TMDB_READ_TOKEN is configured in your Supabase Edge Function secrets or .env file.');
  }
  const url = new URL('https://api.themoviedb.org/3/search/movie');
  url.searchParams.set('query', query);
  url.searchParams.set('include_adult', 'false');
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`TMDB error (${res.status}): ${res.statusText}`);
  }
  const data = await res.json();
  const hits = (data.results as any[]).filter((m) => m.overview && m.poster_path);
  if (!hits.length) return [];

  let ready = new Set<number>();
  if (supabase) {
    const { data: existing } = await supabase
      .from('movies')
      .select('tmdb_id')
      .in('tmdb_id', hits.map((m) => m.id))
      .eq('is_published', true);
    ready = new Set((existing ?? []).map((d) => d.tmdb_id));
  }
  return hits.filter((m) => !ready.has(m.id)).slice(0, 8).map((m) => ({
    tmdb_id: m.id,
    title: m.title,
    year: m.release_date?.slice(0, 4) ?? null,
    poster_path: m.poster_path,
    overview: m.overview,
    ready: ready.has(m.id),
  }));
}

export async function searchTmdb(query: string): Promise<TmdbCandidate[]> {
  try {
    const r = await invoke<{ results: TmdbCandidate[] }>({ query });
    return r.results;
  } catch (err) {
    const token = process.env.NEXT_PUBLIC_TMDB_READ_TOKEN || process.env.TMDB_READ_TOKEN;
    if (token) {
      return await searchTmdbDirect(query);
    }
    const msg = (err as Error)?.message || '';
    if (msg.includes('TMDB') || msg.includes('Lookup failed') || msg.includes('401') || msg.includes('500')) {
      throw new Error('TMDB search failed. Please ensure TMDB_READ_TOKEN is configured in your Supabase Edge Function secrets (or .env file).');
    }
    throw err;
  }
}

export const addFromTmdb = (tmdb_id: number) => invoke<{ status: string }>({ tmdb_id });
