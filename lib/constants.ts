import type { CategoryKey, Filters, Limits } from './types';

export const CATEGORIES: { key: CategoryKey; label: string; icon: string; levels: string[] }[] = [
  { key: 'violence', label: 'Violence', icon: 'Swords', levels: ['None', 'Slapstick', 'Mild', 'Realistic'] },
  { key: 'scariness', label: 'Scary scenes', icon: 'Ghost', levels: ['None', 'Tense', 'Jump scares', 'Intense'] },
  { key: 'language', label: 'Language', icon: 'MessageSquareWarning', levels: ['None', 'Mild', 'Moderate', 'Strong'] },
  { key: 'sexual_content', label: 'Romance & nudity', icon: 'HeartOff', levels: ['None', 'Kissing', 'Suggestive', 'Nudity'] },
  { key: 'mature_themes', label: 'Mature themes', icon: 'CloudRain', levels: ['None', 'Light', 'Serious', 'Heavy'] },
  { key: 'lgbtq_themes', label: 'LGBTQ+ themes', icon: 'Rainbow', levels: ['None', 'Brief', 'Notable', 'Central'] },
];

export const VALUES: { slug: string; label: string }[] = [
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

// TMDB provider ids
export const PROVIDERS: { id: number; name: string }[] = [
  { id: 8, name: 'Netflix' },
  { id: 119, name: 'Prime Video' },
  { id: 122, name: 'Disney+ Hotstar' },
  { id: 337, name: 'Disney+' },
  { id: 1899, name: 'Max' },
  { id: 350, name: 'Apple TV+' },
];

export const COUNTRIES: { code: string; name: string }[] = [
  { code: 'IN', name: 'India' }, { code: 'US', name: 'United States' }, { code: 'GB', name: 'United Kingdom' },
  { code: 'CA', name: 'Canada' }, { code: 'AU', name: 'Australia' }, { code: 'AE', name: 'UAE' },
];

export const allowAll: Limits = { violence: 3, scariness: 3, language: 3, sexual_content: 3, mature_themes: 3, lgbtq_themes: 3 };

export const DEFAULT_FILTERS: Filters = {
  country: 'IN', providers: [8, 119, 122], limits: allowAll, values: [], valuesMode: 'any', maxAge: null, preset: null,
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

export const defaultsFor = (country: string): Filters => ({
  ...DEFAULT_FILTERS,
  country,
  providers: DEFAULT_PROVIDERS[country] ?? [8, 119, 337],
});

export const PRESETS: { id: string; label: string; sub: string; emoji: string; apply: Partial<Filters> }[] = [
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
];

export const valueLabel = (slug: string) => VALUES.find((v) => v.slug === slug)?.label ?? slug;
