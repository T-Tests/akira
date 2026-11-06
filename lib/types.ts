export type Severity = 0 | 1 | 2 | 3;
export type CategoryKey = 'violence' | 'scariness' | 'language' | 'sexual_content' | 'mature_themes' | 'lgbtq_themes';
export type Limits = Record<CategoryKey, Severity>;
export type Audience = 'kids' | 'adults';

export interface Filters {
  audience: Audience;
  country: string;
  providers: number[];
  limits: Limits;
  values: string[];
  valuesMode: 'any' | 'all';
  maxAge: number | null;
  preset: string | null;
  languages: string[];      // original languages to include; empty = any
  skipEnglish: boolean;     // "world cinema" shortcut
  era: string | null;       // id from ERAS; null = any
  bwOnly: boolean;
  genres: string[];
}

export interface Offer { provider_id: number; name: string; type: string; link: string | null; country?: string }

export interface MovieResult extends Limits {
  id: number; tmdb_id: number; title: string; release_year: number | null; runtime_min: number | null;
  poster_path: string | null; takeaway: string | null; advisory: string | null;
  recommended_min_age: number | null; value_slugs: string[] | null; providers: Offer[]; value_match_score: number;
  original_language: string | null; origin_countries: string[]; is_black_and_white: boolean;
  subtitle_languages: string[]; audience: string; review_status?: string;
}

export interface TmdbCandidate {
  tmdb_id: number; title: string; year: string | null; poster_path: string | null; overview: string; ready: boolean;
}
