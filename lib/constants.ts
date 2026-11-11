import type { Audience, CategoryKey, Filters, Limits, Offer } from './types';

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

const OTT_TYPES = new Set(['flatrate', 'free', 'ads']);

export function cleanProviderName(providerId: number, name: string): string {
  const norm = name.toLowerCase();
  if (providerId === 8 || norm.includes('netflix')) return 'Netflix';
  if (providerId === 119 || providerId === 2100 || norm.includes('prime video') || norm.includes('amazon prime')) return 'Prime Video';
  if (providerId === 122 || norm.includes('hotstar')) return 'Disney+ Hotstar';
  if (providerId === 337 || norm.includes('disney')) return 'Disney+';
  if (providerId === 1899 || providerId === 1825 || providerId === 2284 || norm.includes('max') || norm.includes('hbo')) return 'Max';
  if (providerId === 350 || norm.includes('apple tv')) return 'Apple TV+';
  if (providerId === 11 || norm.includes('mubi')) return 'MUBI';
  if (providerId === 258 || norm.includes('criterion')) return 'Criterion Channel';
  if (providerId === 191 || norm.includes('kanopy')) return 'Kanopy';
  if (providerId === 15 || norm.includes('hulu')) return 'Hulu';
  if (providerId === 531 || norm.includes('paramount')) return 'Paramount+';
  if (providerId === 386 || providerId === 387 || norm.includes('peacock')) return 'Peacock';
  if (providerId === 73 || norm.includes('tubi')) return 'Tubi TV';
  if (providerId === 300 || norm.includes('pluto')) return 'Pluto TV';
  if (providerId === 232 || norm.includes('zee5')) return 'Zee5';
  if (providerId === 237 || norm.includes('sonyliv')) return 'SonyLIV';
  if (providerId === 220 || norm.includes('jiocinema')) return 'JioCinema';
  return name;
}

export function canonicalProviderKey(providerId: number, name: string): string {
  const norm = name.toLowerCase();
  if (providerId === 8 || norm.includes('netflix')) return 'netflix';
  if (providerId === 119 || providerId === 2100 || norm.includes('prime video') || norm.includes('amazon prime')) return 'prime';
  if (providerId === 122 || norm.includes('hotstar')) return 'hotstar';
  if (providerId === 337 || norm.includes('disney')) return 'disney';
  if (providerId === 1899 || providerId === 1825 || providerId === 2284 || norm.includes('max') || norm.includes('hbo')) return 'max';
  if (providerId === 350 || norm.includes('apple tv')) return 'appletv';
  if (providerId === 11 || norm.includes('mubi')) return 'mubi';
  if (providerId === 258 || norm.includes('criterion')) return 'criterion';
  if (providerId === 191 || norm.includes('kanopy')) return 'kanopy';
  if (providerId === 15 || norm.includes('hulu')) return 'hulu';
  if (providerId === 531 || norm.includes('paramount')) return 'paramount';
  if (providerId === 386 || providerId === 387 || norm.includes('peacock')) return 'peacock';
  if (providerId === 73 || norm.includes('tubi')) return 'tubi';
  if (providerId === 300 || norm.includes('pluto')) return 'pluto';
  if (providerId === 232 || norm.includes('zee5')) return 'zee5';
  if (providerId === 237 || norm.includes('sonyliv')) return 'sonyliv';
  if (providerId === 220 || norm.includes('jiocinema')) return 'jiocinema';
  return `${providerId}-${norm}`;
}

/** Deduplicate streaming offers so each OTT provider appears only once, preferring flatrate over ads/free, and filtering non-streaming offers. */
export function dedupeProviders(offers: Offer[], userProviders?: number[]): Offer[] {
  if (!offers || !offers.length) return [];

  // Filter out buy/rent offers - keep only OTT streaming options
  const streaming = offers.filter((o) => !o.type || OTT_TYPES.has(o.type));
  const pool = streaming.length > 0 ? streaming : offers;

  const map = new Map<string, Offer>();
  for (const o of pool) {
    const key = canonicalProviderKey(o.provider_id, o.name);
    const cleanName = cleanProviderName(o.provider_id, o.name);
    const existing = map.get(key);
    const candidate: Offer = {
      ...o,
      name: cleanName,
      link: o.link || getOttWatchUrl(o.provider_id, cleanName, ''),
    };

    if (!existing) {
      map.set(key, candidate);
    } else if (existing.type !== 'flatrate' && candidate.type === 'flatrate') {
      map.set(key, candidate);
    }
  }

  const unique = Array.from(map.values());

  // If user has specific streaming services selected, prioritize them
  if (userProviders && userProviders.length > 0) {
    const userKeys = new Set(
      userProviders.map((id) => {
        const found = PROVIDERS.find((p) => p.id === id);
        return canonicalProviderKey(id, found?.name ?? '');
      })
    );
    const matched = unique.filter((o) => userKeys.has(canonicalProviderKey(o.provider_id, o.name)));
    if (matched.length > 0) {
      return matched;
    }
  }

  // Prioritize well-known OTT services and flatrate streaming
  const knownKeys = new Set(PROVIDERS.map((p) => canonicalProviderKey(p.id, p.name)));
  unique.sort((a, b) => {
    const aKnown = knownKeys.has(canonicalProviderKey(a.provider_id, a.name)) ? 1 : 0;
    const bKnown = knownKeys.has(canonicalProviderKey(b.provider_id, b.name)) ? 1 : 0;
    if (aKnown !== bKnown) return bKnown - aKnown;
    if (a.type === 'flatrate' && b.type !== 'flatrate') return -1;
    if (b.type === 'flatrate' && a.type !== 'flatrate') return 1;
    return 0;
  });

  // Keep at most 2 primary OTT options to match normal cards/tile view
  return unique.slice(0, 2);
}

/** Direct link to the movie on the respective OTT platform search/watch page instead of TMDB. */
export function getOttWatchUrl(providerId: number, providerName: string, title: string): string {
  const norm = providerName.toLowerCase();
  const q = encodeURIComponent(title);
  if (providerId === 8 || norm.includes('netflix')) return `https://www.netflix.com/search?q=${q}`;
  if (providerId === 119 || norm.includes('prime')) return `https://www.primevideo.com/search/?phrase=${q}`;
  if (providerId === 122 || norm.includes('hotstar')) return `https://www.hotstar.com/search?q=${q}`;
  if (providerId === 337 || norm.includes('disney')) return `https://www.disneyplus.com/search?q=${q}`;
  if (providerId === 1899 || norm.includes('max')) return `https://play.max.com/search?q=${q}`;
  if (providerId === 350 || norm.includes('apple')) return `https://tv.apple.com/search?term=${q}`;
  if (providerId === 11 || norm.includes('mubi')) return `https://mubi.com/search?query=${q}`;
  if (providerId === 258 || norm.includes('criterion')) return `https://www.criterionchannel.com/search?q=${q}`;
  if (providerId === 191 || norm.includes('kanopy')) return `https://www.kanopy.com/search?query=${q}`;
  if (providerId === 15 || norm.includes('hulu')) return `https://www.hulu.com/search?q=${q}`;
  if (providerId === 531 || norm.includes('paramount')) return `https://www.paramountplus.com/search/?q=${q}`;
  if (providerId === 386 || providerId === 387 || norm.includes('peacock')) return `https://www.peacocktv.com/search?q=${q}`;
  if (providerId === 232 || norm.includes('zee5')) return `https://www.zee5.com/search?q=${q}`;
  if (providerId === 237 || norm.includes('sonyliv')) return `https://www.sonyliv.com/search?query=${q}`;
  if (providerId === 220 || norm.includes('jiocinema')) return `https://www.jiocinema.com/search/${q}`;
  return `https://www.google.com/search?q=${encodeURIComponent(`watch ${title} on ${providerName}`)}`;
}

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
