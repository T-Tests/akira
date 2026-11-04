import type { Audience, CategoryKey, Filters, Limits } from './types';

export const CATEGORIES: { key: CategoryKey; label: string; icon: string; levels: string[] }[] = [
  { key: 'violence', label: 'Violence', icon: 'Swords', levels: ['None', 'Slapstick', 'Mild', 'Realistic'] },
  { key: 'scariness', label: 'Scary scenes', icon: 'Ghost', levels: ['None', 'Tense', 'Jump scares', 'Intense'] },
  { key: 'language', label: 'Language', icon: 'MessageSquareWarning', levels: ['None', 'Mild', 'Moderate', 'Strong'] },
  { key: 'sexual_content', label: 'Romance & nudity', icon: 'HeartOff', levels: ['None', 'Kissing', 'Suggestive', 'Nudity'] },
  { key: 'mature_themes', label: 'Mature themes', icon: 'CloudRain', levels: ['None', 'Light', 'Serious', 'Heavy'] },
  { key: 'lgbtq_themes', label: 'LGBTQ+ themes', icon: 'Rainbow', levels: ['None', 'Brief', 'Notable', 'Central'] },
];

export const KIDS_VALUES: { slug: string; label: string }[] = [
  { slug: 'resilience', label: 'Resilience & grit' },
  { slug: 'stem', label: 'Science & STEM' },
  { slug: 'empathy', label: 'Empathy' },
  { slug: 'teamwork', label: 'Teamwork' },
  { slug: 'problem_solving', label: 'Problem solving' },
  { slug: 'environment', label: 'Caring for nature' },
  { slug: 'creativity', label: 'Creativity' },
  { slug: 'honesty', label: 'Honesty' },
  { slug: 'diversity', label: 'Cultures & inclusion' },
];

export const ADULT_VALUES: { slug: string; label: string }[] = [
  { slug: 'class_society', label: 'Class & society' },
  { slug: 'truth_morality', label: 'Truth & morality' },
  { slug: 'family_belonging', label: 'Family & belonging' },
  { slug: 'love_loss', label: 'Love & loss' },
  { slug: 'identity_memory', label: 'Identity & memory' },
  { slug: 'resistance', label: 'Courage & resistance' },
  { slug: 'craft', label: 'Masterful filmmaking' },
];

export const VALUES = [...KIDS_VALUES, ...ADULT_VALUES];
export const valuesFor = (a: Audience) => (a === 'kids' ? KIDS_VALUES : ADULT_VALUES);

export const LANGUAGES = ['en', 'hi', 'bn', 'ta', 'te', 'ml', 'mr', 'ja', 'ko', 'zh', 'fr', 'es', 'it', 'de', 'pt', 'ru', 'sv', 'fa', 'ar', 'tr'];
export const GENRES = ['Drama', 'Comedy', 'Thriller', 'Romance', 'Crime', 'War', 'History', 'Mystery', 'Science Fiction', 'Music', 'Documentary', 'Horror', 'Animation'];

export const ERAS: { id: string; label: string; min: number | null; max: number | null }[] = [
  { id: 'early', label: 'Silent & early (to 1945)', min: null, max: 1945 },
  { id: 'golden', label: 'Golden age (1946-69)', min: 1946, max: 1969 },
  { id: 'newwave', label: 'New waves (1970-89)', min: 1970, max: 1989 },
  { id: 'modern', label: '1990-2009', min: 1990, max: 2009 },
  { id: 'now', label: '2010 onwards', min: 2010, max: null },
];

/** Human language/country names in the visitor's own language. */
export function langName(code: string | null): string {
  if (!code) return '';
  try { return new Intl.DisplayNames(undefined, { type: 'language' }).of(code) ?? code; } catch { return code; }
}
export function countryName(code: string): string {
  try { return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code; } catch { return code; }
}

// TMDB provider ids
export const PROVIDERS: { id: number; name: string }[] = [
  { id: 8, name: 'Netflix' },
  { id: 119, name: 'Prime Video' },
  { id: 122, name: 'Disney+ Hotstar' },
  { id: 337, name: 'Disney+' },
  { id: 1899, name: 'Max' },
  { id: 350, name: 'Apple TV+' },
  // World-cinema services. Confirm ids with TMDB /watch/providers/movie before relying on them.
  { id: 11, name: 'MUBI' },
  { id: 258, name: 'Criterion Channel' },
  { id: 191, name: 'Kanopy' },
];

export const COUNTRIES: { code: string; name: string }[] = [
  { code: 'IN', name: 'India' }, { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' }, { code: 'AU', name: 'Australia' }, { code: 'AE', name: 'UAE' },
];

export const allowAll: Limits = { violence: 3, scariness: 3, language: 3, sexual_content: 3, mature_themes: 3, lgbtq_themes: 3 };

const WORLD = { languages: [] as string[], skipEnglish: false, era: null as string | null, bwOnly: false, genres: [] as string[] };

export const DEFAULT_FILTERS: Filters = {
  audience: 'kids', country: 'IN', providers: [8, 119, 122], limits: allowAll, values: [], valuesMode: 'any',
  maxAge: null, preset: null, ...WORLD,
};

const DEFAULT_COUNTRY = 'IN';
const DEFAULT_PROVIDERS: Record<string, number[]> = { IN: [8, 119, 122] };

/** Best-effort region from the browser locale (e.g. en-GB -> GB); falls back to India. */
export function detectCountry(): string {
  const langs = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language];
  for (const l of langs) {
    const region = l?.split('-')[1]?.toUpperCase();
    if (region && COUNTRIES.some((c) => c.code === region)) return region;
  }
  return DEFAULT_COUNTRY;
}

export const providersFor = (country: string) => DEFAULT_PROVIDERS[country] ?? [8, 119, 337];

export const freshFilters = (audience: Audience, country: string, providers = providersFor(country)): Filters => ({
  ...DEFAULT_FILTERS, audience, country, providers,
});

export type Preset = { id: string; label: string; sub: string; emoji: string; apply: Partial<Filters> };

export const PRESETS: Record<Audience, Preset[]> = {
  kids: [
    {
      id: 'gentle', label: 'Gentle & Curious', sub: 'Ages 3-6', emoji: '🧸',
      apply: { limits: { violence: 1, scariness: 1, language: 0, sexual_content: 0, mature_themes: 1, lgbtq_themes: 3 }, values: ['empathy', 'creativity', 'environment'], valuesMode: 'any', maxAge: 6 },
    },
    {
      id: 'stem', label: 'Science & Problem Solving', sub: 'Ages 7-10', emoji: '🔬',
      apply: { limits: { violence: 2, scariness: 2, language: 1, sexual_content: 0, mature_themes: 2, lgbtq_themes: 3 }, values: ['stem', 'problem_solving'], valuesMode: 'any', maxAge: 10 },
    },
    {
      id: 'bio', label: 'Inspiring Stories', sub: 'Teens', emoji: '🌟',
      apply: { limits: { violence: 2, scariness: 2, language: 2, sexual_content: 1, mature_themes: 3, lgbtq_themes: 3 }, values: ['resilience', 'teamwork'], valuesMode: 'any', maxAge: 16 },
    },
  ],
  adults: [
    { id: 'bw', label: 'Black & White Classics', sub: 'Timeless', emoji: '🎞️', apply: { bwOnly: true } },
    { id: 'world', label: 'World Cinema', sub: 'Beyond English', emoji: '🌍', apply: { skipEnglish: true } },
    { id: 'golden', label: 'Golden Age', sub: '1946-1969', emoji: '🕰️', apply: { era: 'golden' } },
  ],
};

export const valueLabel = (slug: string) => VALUES.find((v) => v.slug === slug)?.label ?? slug;
