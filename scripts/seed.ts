/** Loads data/seed.json into Supabase:  npm run seed  (needs SUPABASE_URL + service role key) */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const seed = JSON.parse(await readFile('data/seed.json', 'utf8'));
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const must = <T>(r: { data: T; error: any }) => { if (r.error) throw r.error; return r.data; };

must(await db.from('streaming_providers').upsert(seed.providers, { onConflict: 'provider_id' }));
const values = must(await db.from('inspirational_values').select('id,slug'));
const vid = new Map(values!.map((v: any) => [v.slug, v.id]));

for (const m of seed.movies) {
  const row: any = must(await db.from('movies').upsert({
    tmdb_id: m.tmdb_id, title: m.title, release_year: m.release_year, runtime_min: m.runtime_min,
    poster_path: m.poster_path, overview: m.overview, recommended_min_age: m.recommended_min_age,
    tmdb_vote_avg: m.tmdb_vote_avg, takeaway: m.takeaway, advisory: m.advisory,
    review_status: 'human_verified', is_published: true,
  }, { onConflict: 'tmdb_id' }).select('id').single());

  must(await db.from('content_warnings').upsert({ movie_id: row.id, ...m.content, source: 'curated', confidence: 1 }));
  must(await db.from('movie_values').delete().eq('movie_id', row.id));
  must(await db.from('movie_values').insert(m.values.map((v: any) => ({ movie_id: row.id, value_id: vid.get(v.slug), strength: v.strength }))));
  must(await db.from('streaming_cache').delete().eq('movie_id', row.id));
  const offers = Object.entries(m.streaming).flatMap(([cc, list]: [string, any]) =>
    list.map((o: any) => ({
      movie_id: row.id, country_code: cc, provider_id: o.provider_id, monetization_type: o.type,
      deep_link: `https://www.themoviedb.org/movie/${m.tmdb_id}/watch?locale=${cc}`,
    })));
  must(await db.from('streaming_cache').insert(offers));
  console.log('✓', m.title);
}
