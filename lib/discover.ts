import { createClient } from '@supabase/supabase-js';
import seed from '@/data/seed.json';
import { ERAS, dedupeProviders, getOttWatchUrl } from './constants';
import type { Filters, MovieResult } from './types';

const eraOf = (id: string | null) => ERAS.find((e) => e.id === id);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const usingMock = !url || !anon;
export const supabase = usingMock ? null : createClient(url!, anon!);

/** One RPC per search when Supabase is configured; otherwise filters bundled seed data locally. */
export const PAGE_SIZE = 48;

/** Returns one page plus whether more exist (fetches PAGE_SIZE + 1 rows to know). */
export async function discover(f: Filters, offset = 0): Promise<{ movies: MovieResult[]; hasMore: boolean }> {
  const rows = await fetchRows(f, offset);
  return { movies: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

async function fetchRows(f: Filters, offset: number): Promise<MovieResult[]> {
  if (supabase) {
    const { data, error } = await supabase.rpc('discover_movies', {
      p_country: null,
      p_providers: f.providers,
      p_audience: f.audience,
      p_max_violence: f.limits.violence,
      p_max_scariness: f.limits.scariness,
      p_max_language: f.limits.language,
      p_max_sexual: f.limits.sexual_content,
      p_max_mature: f.limits.mature_themes,
      p_max_lgbtq: f.limits.lgbtq_themes,
      p_values: f.values.length ? f.values : null,
      p_values_mode: f.valuesMode,
      p_max_age: f.maxAge,
      p_languages: f.languages.length ? f.languages : null,
      p_exclude_languages: f.skipEnglish ? ['en'] : null,
      p_year_min: eraOf(f.era)?.min ?? null,
      p_year_max: eraOf(f.era)?.max ?? null,
      p_bw_only: f.bwOnly,
      p_genres: f.genres.length ? f.genres : null,
      p_limit: PAGE_SIZE + 1,
      p_offset: offset,
    });
    if (error) throw error;
    return data as MovieResult[];
  }
  return mockDiscover(f).slice(offset, offset + PAGE_SIZE + 1);
}

function mockDiscover(f: Filters): MovieResult[] {
  const names = new Map(seed.providers.map((p) => [p.provider_id, p.name]));
  const out: MovieResult[] = [];
  const era = eraOf(f.era);
  seed.movies.forEach((m, i) => {
    if (f.audience === 'kids' && !(m.audience === 'both' || m.audience === 'kids')) return;
    const lang = m.original_language;
    if (f.languages.length && !f.languages.includes(lang)) return;
    if (f.skipEnglish && lang === 'en') return;
    if (era?.min && m.release_year < era.min) return;
    if (era?.max && m.release_year > era.max) return;
    if (f.bwOnly && !m.is_black_and_white) return;
    if (f.genres.length && !f.genres.some((g) => m.tmdb_genres.includes(g))) return;
    const offers = Object.entries(m.streaming as Record<string, { provider_id: number; type: string }[]>)
      .flatMap(([country, entries]) => entries.map((o) => ({ ...o, country })))
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
      providers: dedupeProviders(offers.map((o) => ({
        provider_id: o.provider_id, name: names.get(o.provider_id) ?? String(o.provider_id), type: o.type, country: o.country,
        link: getOttWatchUrl(o.provider_id, names.get(o.provider_id) ?? String(o.provider_id), m.title),
      }))),
      original_language: lang, origin_countries: m.origin_countries, is_black_and_white: m.is_black_and_white,
      subtitle_languages: m.subtitle_languages, audience: m.audience,
      value_match_score: mine.reduce((s, v) => s + v.strength, 0),
    });
  });
  return out.sort((a, b) => b.value_match_score - a.value_match_score);
}
