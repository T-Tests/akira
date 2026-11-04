'use client';
import { useEffect, useState } from 'react';
import { SlidersHorizontal, Loader2, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterDrawer } from '@/components/filter-drawer';
import { MovieCard } from '@/components/movie-card';
import { DEFAULT_FILTERS, PRESETS, defaultsFor, detectCountry } from '@/lib/constants';
import { discover, usingMock } from '@/lib/discover';
import { cn } from '@/lib/utils';
import type { Filters, MovieResult } from '@/lib/types';

const KEY = 'akira:filters:v1';

export default function Home() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [movies, setMovies] = useState<MovieResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      setFilters(s ? { ...DEFAULT_FILTERS, ...JSON.parse(s) } : defaultsFor(detectCountry()));
    } catch {}
    setHydrated(true);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js');
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(KEY, JSON.stringify(filters));
    let stale = false;
    setError(null);
    const t = setTimeout(() => {
      discover(filters).then((r) => !stale && setMovies(r)).catch((e) => !stale && setError(e.message));
    }, 150);
    return () => { stale = true; clearTimeout(t); };
  }, [filters, hydrated]);

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    const { limits, values, valuesMode, maxAge } = DEFAULT_FILTERS;
    setFilters(filters.preset === id
      ? { ...filters, limits, values, valuesMode, maxAge, preset: null }
      : { ...filters, ...p.apply, preset: id });
  };

  return (
    <main className="mx-auto min-h-dvh max-w-xl pb-28">
      <header className="sticky top-0 z-30 border-b bg-white/90 px-4 pb-3 pt-4 backdrop-blur">
        <h1 className="text-xl font-extrabold text-brand-700">Akira ✨</h1>
        <p className="text-xs text-slate-500">Pick a vibe. Watch in under a minute.</p>
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {PRESETS.map((p) => (
            <button key={p.id} onClick={() => applyPreset(p.id)} aria-pressed={filters.preset === p.id}
              className={cn('shrink-0 rounded-2xl border px-4 py-2 text-left transition',
                filters.preset === p.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white')}>
              <div className="text-sm font-bold">{p.emoji} {p.label}</div>
              <div className={cn('text-xs', filters.preset === p.id ? 'text-brand-100' : 'text-slate-500')}>{p.sub}</div>
            </button>
          ))}
        </div>
      </header>

      <section className="space-y-4 px-4 pt-4" aria-live="polite">
        {usingMock && <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Demo mode: showing 5 sample films. Connect Supabase for the full catalogue.</p>}
        {error && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">Couldn&apos;t load movies: {error}</p>}
        {movies === null && !error && <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>}
        {movies?.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-center">
            <SearchX className="mx-auto h-8 w-8 text-slate-400" />
            <h2 className="mt-2 font-bold">Nothing matches on your apps</h2>
            <p className="mt-1 text-sm text-slate-600">Titles can be unavailable in your region or on your services. You could:</p>
            <ul className="mx-auto mt-2 max-w-xs list-disc pl-5 text-left text-sm text-slate-600">
              <li>Add another streaming service you have</li>
              <li>Loosen a content slider or value filter</li>
              <li>Check legal rent/buy options on your platform's store</li>
              <li>Borrow it free from a local library (Libby, Kanopy, Hoopla)</li>
            </ul>
            <Button variant="outline" className="mt-4" onClick={() => setOpen(true)}>Adjust filters</Button>
          </div>
        )}
        {movies?.map((m) => <MovieCard key={m.id} m={m} />)}
        {process.env.NEXT_PUBLIC_REPORT_URL && (
          <p className="pt-2 text-center text-xs">
            <a className="text-brand-700 underline" href={process.env.NEXT_PUBLIC_REPORT_URL} target="_blank" rel="noopener noreferrer">
              Report a wrong rating
            </a>
          </p>
        )}
        <p className="pt-4 text-center text-[11px] text-slate-400">
          Movie data and streaming availability from TMDB / JustWatch. This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-slate-50 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        <Button className="mx-auto flex w-full max-w-xl shadow-lg" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" /> Boundaries & values
        </Button>
      </div>

      <FilterDrawer open={open} onOpenChange={setOpen} filters={filters} setFilters={setFilters} count={movies?.length ?? 0} />
    </main>
  );
}
