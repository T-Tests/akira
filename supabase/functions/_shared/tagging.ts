// Single source for the tagging prompt + output schema. Used by scripts/tag-movies.ts (Node)
// and supabase/functions/lookup (Deno), so keep it free of runtime-specific APIs.
import { z } from 'zod';

const sev = z.number().int().min(0).max(3);
export const Tag = z.object({
  tmdb_id: z.number().int(),
  violence: sev, scariness: sev, language: sev,
  sexual_content: sev, mature_themes: sev, lgbtq_themes: sev,
  notes: z.record(z.string()).default({}),
  values: z.array(z.object({
    slug: z.enum([
      'resilience', 'stem', 'empathy', 'teamwork', 'problem_solving', 'environment', 'creativity', 'honesty', 'diversity',
      'class_society', 'truth_morality', 'family_belonging', 'love_loss', 'identity_memory', 'resistance', 'craft',
    ]),
    strength: z.number().int().min(1).max(3),
  })).max(4),
  takeaway: z.string().min(10).max(400),
  advisory: z.string().min(3).max(400),
  recommended_min_age: z.number().int().min(0).max(18),
  confidence: z.number().min(0).max(1),
});

export const STRICT_PREFIX =
  'You are a strict, safety-first parent reviewer. When unsure, rate the content higher, never lower. Re-rate this film independently.\n\n';

export interface PromptVars {
  title: string; year: string; tmdb_id: string; audience: string;
  language: string; overview: string; parents_guide: string;
}

export const TAGGING_PROMPT = `You are a careful film analyst for a recommender with a Kids audience (parents choosing for children) and an Adults audience (people exploring world cinema).
Convert the raw parents-guide data below into a strict JSON object. Be conservative:
when evidence is ambiguous, choose the HIGHER severity. Never invent scenes; use only the supplied text.

## Severity scale (integers 0-3)
- violence:       0 none | 1 slapstick/cartoon | 2 mild peril, non-graphic conflict | 3 realistic or graphic harm
- scariness:      0 none | 1 mildly tense | 2 jump scares / frightening villains or scenes | 3 intense, disturbing, nightmare-inducing
- language:       0 none | 1 name-calling, mild words | 2 moderate profanity | 3 strong / explicit
- sexual_content: 0 none | 1 kissing / romance | 2 innuendo, suggestive | 3 nudity / explicit
- mature_themes:  0 none | 1 light (bullying, minor loss) | 2 serious (death of a character, divorce, illness) | 3 heavy (abuse, war, suicide, addiction)
- lgbtq_themes:   0 none | 1 brief / background | 2 notable | 3 central. Descriptive only; do not judge.

## Value tags (choose 0-4; strength 1-3, 3 = core theme of the film)
Audience = {{audience}}.
- kids / both: resilience, stem, empathy, teamwork, problem_solving, environment, creativity, honesty, diversity
- adults: class_society, truth_morality, family_belonging, love_loss, identity_memory, resistance, craft
(For "both", pick whichever list fits best; kids slugs preferred.)
Only tag a value if it is clearly depicted. Do not tag generic "friendship" as teamwork.

## Writing rules for \`takeaway\` and \`advisory\`
- takeaway: EXACTLY 2 sentences, <= 45 words total. Spoiler-free, warm but not preachy.
  Kids: what a child may take away. Adults: why the film is worth seeking out (craft, place in cinema history, what it feels like to watch),
  mentioning pace or era if it helps a newcomer (e.g. "slow, black and white, subtitled"). Never gatekeep or condescend.
- advisory: <= 2 sentences naming the specific flags >= 2 (what and roughly when). "Nothing notable." if all <= 1.
- recommended_min_age: integer 0-18, based on the highest-severity category (adult films: typically 13-18).

## Output (JSON only, no prose, no markdown fences)
{
  "tmdb_id": <number>,
  "violence": 0-3, "scariness": 0-3, "language": 0-3,
  "sexual_content": 0-3, "mature_themes": 0-3, "lgbtq_themes": 0-3,
  "notes": { "<category>": "<short specific note>" },
  "values": [ { "slug": "<value>", "strength": 1-3 } ],
  "takeaway": "...", "advisory": "...",
  "recommended_min_age": <number>,
  "confidence": 0.0-1.0
}

## Input
Title: {{title}} ({{year}})  TMDB: {{tmdb_id}}
Original language: {{language}}
Overview: {{overview}}
Parents guide (IMDb-style, user-supplied; may be empty):
{{parents_guide}}
`;

export const fillPrompt = (v: PromptVars) =>
  (Object.keys(v) as (keyof PromptVars)[]).reduce((s, k) => s.replace(`{{${k}}}`, () => v[k]), TAGGING_PROMPT);
