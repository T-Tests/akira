/**
 * Review helper for the (now rare) manual cases.
 *   npm run review -- --list                      films waiting for a human (tagged but unpublished)
 *   npm run review -- --approve 603,680           publish after you checked them
 *   npm run review -- --unpublish 603             pull a film (e.g. after a "wrong rating" report)
 *   npm run review -- --reject 603                hide permanently (will not be re-tagged)
 *   npm run review -- --audit 20                  random sample of auto-published films to spot-check
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const { values: a } = parseArgs({
  options: {
    list: { type: 'boolean' }, approve: { type: 'string' }, unpublish: { type: 'string' },
    reject: { type: 'string' }, audit: { type: 'string' },
  },
});
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const ids = (s: string) => s.split(',').map((x) => Number(x.trim())).filter(Boolean);

async function setStatus(list: string, review_status: string, is_published: boolean) {
  const { data, error } = await db.from('movies').update({ review_status, is_published }).in('tmdb_id', ids(list)).select('tmdb_id,title');
  if (error) throw error;
  console.log(`${review_status}:`, data?.map((m) => `${m.title} (${m.tmdb_id})`).join(', ') || 'no matches');
}

if (a.approve) await setStatus(a.approve, 'human_verified', true);
else if (a.unpublish) await setStatus(a.unpublish, 'llm_tagged', false);
else if (a.reject) await setStatus(a.reject, 'rejected', false);
else {
  const sample = a.audit !== undefined;
  const q = db.from('movies')
    .select('tmdb_id,title,release_year,audience,takeaway,content_warnings(violence,scariness,language,sexual_content,mature_themes,lgbtq_themes,confidence)')
    .eq('review_status', sample ? 'auto_approved' : 'llm_tagged').limit(sample ? 500 : 100);
  const { data, error } = await q;
  if (error) throw error;
  const rows = sample ? [...(data ?? [])].sort(() => Math.random() - 0.5).slice(0, Number(a.audit) || 20) : data ?? [];
  for (const m of rows as any[]) {
    const c = Array.isArray(m.content_warnings) ? m.content_warnings[0] : m.content_warnings;
    console.log(`${m.tmdb_id} ${m.title} (${m.release_year}) [${m.audience}]`);
    if (c) console.log(`   V${c.violence} S${c.scariness} L${c.language} X${c.sexual_content} M${c.mature_themes} Q${c.lgbtq_themes} conf=${c.confidence}`);
    console.log(`   ${m.takeaway}`);
  }
  console.log(`\n${rows.length} film(s).`);
}
