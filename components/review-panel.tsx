'use client';
import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { CATEGORIES, valueLabel } from '@/lib/constants';
import { listReview, reviewMovie } from '@/lib/review';
import type { Audience, ReviewMovie } from '@/lib/types';

export function ReviewPanel({ onChanged }: { onChanged?: () => void }) {
  const [items, setItems] = useState<ReviewMovie[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => { listReview().then(setItems).catch((e) => setError(e.message)); }, []);

  const decide = async (m: ReviewMovie, audience: Audience) => {
    setBusy(m.tmdb_id);
    setError(null);
    try {
      await reviewMovie(m.tmdb_id, audience);
      setItems((cur) => (cur ?? []).filter((x) => x.tmdb_id !== m.tmdb_id));
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="grid grid-cols-1 gap-4 px-4 pt-4 md:grid-cols-2 md:px-6 lg:grid-cols-3">
      <p className="col-span-full rounded-lg bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-900/20 dark:text-sky-100">
        These films need a human decision. Choose where each belongs: it is published there and saved to the database.
      </p>
      {error && <p className="col-span-full rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">{error}</p>}
      {items === null && !error && <div className="col-span-full flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>}
      {items?.length === 0 && (
        <p className="col-span-full flex items-center justify-center gap-2 py-12 text-slate-500"><CheckCircle2 className="h-5 w-5" />Nothing left to review.</p>
      )}
      {items?.map((m) => {
        const flags = CATEGORIES.filter((c) => m[c.key] > 0);
        return (
          <article key={m.id} className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex gap-3">
              <div className="h-28 w-20 shrink-0 overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-700">
                {m.poster_path && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`https://image.tmdb.org/t/p/w185${m.poster_path}`} alt={`${m.title} poster`} loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="font-bold leading-tight">{m.title}</h2>
                <p className="text-xs text-slate-500">
                  {m.release_year}{m.recommended_min_age != null && ` · AI suggests ages ${m.recommended_min_age}+`}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {flags.length === 0 && <Badge>No content flags</Badge>}
                  {flags.map((c) => <Badge key={c.key}>{c.label}: {c.levels[m[c.key]]}</Badge>)}
                </div>
              </div>
            </div>
            {m.advisory && <p><b>What to know:</b> {m.advisory}</p>}
            {m.overview && <p className="line-clamp-3 text-xs text-slate-600 dark:text-slate-300">{m.overview}</p>}
            <div className="flex flex-wrap gap-1">
              {m.value_slugs.map((s) => <Badge key={s} className="bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">{valueLabel(s)}</Badge>)}
            </div>
            <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
              <Button disabled={busy === m.tmdb_id} onClick={() => decide(m, 'kids')}>🧒 Approve for Kids</Button>
              <Button variant="outline" disabled={busy === m.tmdb_id} onClick={() => decide(m, 'adults')}>🎬 Move to Adults</Button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
