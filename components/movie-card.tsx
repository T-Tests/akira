'use client';
import { useState } from 'react';
import { AlertTriangle, ExternalLink, Sparkles, Clock, Tv, Globe, Film } from 'lucide-react';
import { Badge } from './ui/badge';
import { CATEGORIES, countryName, langName, valueLabel } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { MovieResult } from '@/lib/types';

const SEV = ['bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200', 'bg-lime-100 dark:bg-lime-900/40 text-lime-800 dark:text-lime-200', 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200', 'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200'];

export function MovieCard({ m }: { m: MovieResult }) {
  const [imgOk, setImgOk] = useState(true);
  const flags = CATEGORIES.filter((c) => m[c.key] > 0);
  const watch = m.providers.find((p) => p.type === 'flatrate') ?? m.providers[0];

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
      <div className="flex gap-3 p-3">
        <div className="h-36 w-24 shrink-0 overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-700">
          {imgOk && m.poster_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`https://image.tmdb.org/t/p/w342${m.poster_path}`} alt={`${m.title} poster`} loading="lazy"
              className="h-full w-full object-cover" onError={() => setImgOk(false)} />
          ) : (
            <div className="flex h-full items-center justify-center p-2 text-center text-xs font-semibold text-slate-500">{m.title}</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold leading-tight">{m.title}</h2>
          {m.review_status === 'ai_reviewed' && (
            <Badge className="mt-1 bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200">
              <Sparkles className="h-3 w-3" />AI-reviewed · unverified
            </Badge>
          )}
          <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            {m.release_year}
            {m.runtime_min && <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" />{m.runtime_min} min</span>}
            {m.recommended_min_age != null && <span>Ages {m.recommended_min_age}+</span>}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {m.providers.map((p) => (
              <Badge key={p.provider_id + p.type} className="bg-brand-50 dark:bg-brand-700/20 text-brand-700 dark:text-brand-100"><Tv className="h-3 w-3" />{p.name}{p.type === 'ads' ? ' (ads)' : p.type === 'free' ? ' (free)' : ''}</Badge>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 px-3 pb-3 text-sm">
        {(m.original_language || m.is_black_and_white) && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
            {m.original_language && (
              <span className="flex items-center gap-1">
                <Globe className="h-3.5 w-3.5" />
                {langName(m.original_language)}
                {m.origin_countries.length > 0 && ` · ${m.origin_countries.slice(0, 2).map(countryName).join(', ')}`}
              </span>
            )}
            {m.is_black_and_white && <span className="flex items-center gap-1"><Film className="h-3.5 w-3.5" />Black &amp; white</span>}
            {m.original_language && m.original_language !== 'en' && (
              <span className="basis-full text-slate-500">
                {m.subtitle_languages.length > 0
                  ? `Subtitles: ${m.subtitle_languages.map(langName).join(', ')} (confirm in the app)`
                  : 'Subtitles or dubs vary by app: check before you start.'}
              </span>
            )}
          </p>
        )}
        {m.takeaway && (
          <p className="flex gap-2 rounded-xl bg-brand-50 dark:bg-brand-700/20 p-3 text-slate-800 dark:text-slate-100">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /><span><b>Why watch:</b> {m.takeaway}</span>
          </p>
        )}
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3">
          <p className="flex gap-2 text-slate-800 dark:text-slate-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><span><b>What to know:</b> {m.advisory ?? 'No advisory yet.'}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {flags.length === 0 && <Badge className={SEV[0]}>No content flags</Badge>}
            {flags.map((c) => <Badge key={c.key} className={cn(SEV[m[c.key]])}>{c.label}: {c.levels[m[c.key]]}</Badge>)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {m.value_slugs.slice(0, 4).map((s) => <Badge key={s} className="bg-violet-100 dark:bg-violet-900/40 text-violet-800 dark:text-violet-200">{valueLabel(s)}</Badge>)}
        </div>
        {watch?.link && (
          <a href={watch.link} target="_blank" rel="noopener noreferrer"
            className="mt-auto flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-600 font-semibold text-white active:scale-[.98]">
            Watch on {watch.name} <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </article>
  );
}
