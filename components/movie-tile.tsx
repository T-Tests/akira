'use client';
import { useState } from 'react';
import { Sheet } from './ui/sheet';
import { MovieCard } from './movie-card';
import { dedupeProviders, langName } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { MovieResult } from '@/lib/types';

const worst = (m: MovieResult) => Math.max(m.violence, m.scariness, m.language, m.sexual_content, m.mature_themes, m.lgbtq_themes);
const DOT = ['bg-emerald-500', 'bg-lime-500', 'bg-amber-500', 'bg-rose-500'];

/** Compact poster tile; tap opens the full card in a sheet. */
export function MovieTile({ m }: { m: MovieResult }) {
  const [open, setOpen] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  const uniqueProviders = dedupeProviders(m.providers);
  return (
    <>
      <button onClick={() => setOpen(true)} className="group text-left" aria-label={`${m.title}, details`}>
        <div className="relative aspect-[2/3] overflow-hidden rounded-xl bg-slate-200 shadow-sm dark:bg-slate-700">
          {imgOk && m.poster_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`https://image.tmdb.org/t/p/w342${m.poster_path}`} alt="" loading="lazy" onError={() => setImgOk(false)}
              className="h-full w-full object-cover transition group-active:scale-[.98]" />
          ) : (
            <div className="flex h-full items-center justify-center p-2 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">{m.title}</div>
          )}
          <span className={cn('absolute right-1.5 top-1.5 h-3 w-3 rounded-full ring-2 ring-white dark:ring-slate-900', DOT[worst(m)])} title="Highest content level" />
        </div>
        <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-tight">{m.title}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {m.recommended_min_age != null ? `${m.recommended_min_age}+ · ` : ''}{m.original_language && m.original_language !== 'en' ? `${langName(m.original_language)} · ` : ''}{m.is_black_and_white ? 'B&W · ' : ''}{uniqueProviders[0]?.name}
        </p>
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={m.title}>
        <MovieCard m={m} />
      </Sheet>
    </>
  );
}
