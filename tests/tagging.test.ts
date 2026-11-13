import assert from 'node:assert/strict';
import { Tag, fillPrompt, parseJsonSafe } from '../supabase/functions/_shared/tagging.ts';

const vars = {
  title: 'Example', year: '2026', tmdb_id: '42', language: 'en',
  overview: 'A story.', parents_guide: '(none provided)',
};
assert.doesNotMatch(fillPrompt({ ...vars, audience: 'adults' }), /"confidence":/);
assert.match(fillPrompt({ ...vars, audience: 'kids' }), /"confidence":/);
const tagged = {
  tmdb_id: 42, violence: 0, scariness: 0, language: 0,
  sexual_content: 0, mature_themes: 0, lgbtq_themes: 0,
  values: [], takeaway: 'A sample takeaway.', advisory: 'Nothing notable.', recommended_min_age: 13,
};
assert.equal(Tag.parse(tagged).confidence, undefined);
assert.throws(() => Tag.parse({ ...tagged, violence: 4 }));

// Verify parseJsonSafe handles raw JSON and markdown code blocks from LLMs
assert.deepEqual(parseJsonSafe('{"hello": "world"}'), { hello: 'world' });
assert.deepEqual(parseJsonSafe('```json\n{"hello": "world"}\n```'), { hello: 'world' });
assert.deepEqual(parseJsonSafe('```\n{"hello": "world"}\n```'), { hello: 'world' });

console.log('Tagging contract checks passed.');
