import { createClient } from '@supabase/supabase-js';
import seed from '@/data/seed.json';
import type { Filters, MovieResult } from './types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const usingMock = !url || !anon;
const supabase = usingMock ? null : createClient(url!, anon!, { auth: { persistSession: false } });

/** One RPC per search when Supabase is configured; otherwise filters bundled seed data locally. */
export async function discover(f: Filters): Promise<MovieResult[]> {
  if (supabase) {
    const { data, error } = await supabase.rpc('discover_movies', {
      p_country: f.country,
      p_providers: f.providers,
      p_max_violence: f.limits.violence,
      p_max_scariness: f.limits.scariness,
      p_max_language: f.limits.language,
      p_max_sexual: f.limits.sexual_content,
      p_max_mature: f.limits.mature_themes,
      p_max_lgbtq: f.limits.lgbtq_themes,
      p_values: f.values.length ? f.values : null,
      p_values_mode: f.valuesMode,
      p_max_age: f.maxAge,
      p_limit: 30,
    });
    if (error) throw error;
    return data as MovieResult[];
  }
  return mockDiscover(f);
}

function mockDiscover(f: Filters): MovieResult[] {
  const names = new Map(seed.providers.map((p) => [p.provider_id, p.name]));
  const out: MovieResult[] = [];
  seed.movies.forEach((m, i) => {
    const offers = ((m.streaming as Record<string, { provider_id: number; type: string }[]>)[f.country] ?? [])
      .filter((o) => f.providers.includes(o.provider_id) && ['flatrate', 'free', 'ads'].includes(o.type));
    if (!offers.length) return;
    const c = m.content as Record<string, number>;
    if (Object.entries(f.limits).some(([k, max]) => c[k] > max)) return;
    if (f.maxAge != null && m.recommended_min_age > f.maxAge) return;
    const mine = m.values.filter((v) => f.values.includes(v.slug));
    if (f.values.length && (f.valuesMode === 'all' ? mine.length < f.values.length : mine.length === 0)) return;
    out.push({
      id: i + 1, tmdb_id: m.tmdb_id, title: m.title, release_year: m.release_year, runtime_min: m.runtime_min,
      poster_path: m.poster_path, takeaway: m.takeaway, advisory: m.advisory, recommended_min_age: m.recommended_min_age,
      ...(c as any),
      value_slugs: [...m.values].sort((a, b) => b.strength - a.strength).map((v) => v.slug),
      providers: offers.map((o) => ({
        provider_id: o.provider_id, name: names.get(o.provider_id) ?? String(o.provider_id), type: o.type,
        link: `https://www.themoviedb.org/movie/${m.tmdb_id}/watch?locale=${f.country}`,
      })),
      value_match_score: mine.reduce((s, v) => s + v.strength, 0),
    });
  });
  return out.sort((a, b) => b.value_match_score - a.value_match_score);
}
