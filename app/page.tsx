'use client';
import { useEffect, useState } from 'react';
import { SlidersHorizontal, Loader2, SearchX, LayoutGrid, List, Search } from 'lucide-react';
import { SearchPanel } from '@/components/search-panel';
import { Button } from '@/components/ui/button';
import { FilterDrawer } from '@/components/filter-drawer';
import { MovieCard } from '@/components/movie-card';
import { MovieTile } from '@/components/movie-tile';
import { KidsReview } from '@/components/kids-review';
import { ThemeToggle } from '@/components/theme-toggle';
import { PRESETS, detectCountry, freshFilters } from '@/lib/constants';
import { discover, usingMock, PAGE_SIZE } from '@/lib/discover';
import { cn } from '@/lib/utils';
import type { Audience, Filters, MovieResult } from '@/lib/types';

const KEY = 'akira:state:v2';

interface State { audience: Audience; kids: Filters; adults: Filters }
const initial = (country = 'IN'): State => ({ audience: 'kids', kids: freshFilters('kids', country), adults: freshFilters('adults', country) });
const VIEW_KEY = 'akira:view';

export default function Home() {
  const [state, setState] = useState<State>(initial());
  const filters = state[state.audience];
  const audience = state.audience;
  // Country and streaming apps are shared by both tabs; everything else is kept per tab.
  const setFilters = (f: Filters) =>
    setState((st) => {
      const other: Audience = st.audience === 'kids' ? 'adults' : 'kids';
      const shared = f.country !== st[st.audience].country || f.providers !== st[st.audience].providers;
      return {
        ...st,
        [st.audience]: f,
        ...(shared ? { [other]: { ...st[other], country: f.country, providers: f.providers } } : {}),
      };
    });
  const [reviewing, setReviewing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [view, setView] = useState<'detail' | 'grid'>('detail');
  const [movies, setMovies] = useState<MovieResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const j = JSON.parse(saved);
        const base = initial(j.kids?.country);
        setState({ audience: j.audience === 'adults' ? 'adults' : 'kids', kids: { ...base.kids, ...j.kids }, adults: { ...base.adults, ...j.adults } });
      } else setState(initial(detectCountry()));
    } catch {}
    if (localStorage.getItem(VIEW_KEY) === 'grid') setView('grid');
    if (new URLSearchParams(window.location.search).get('review') === 'kids') {
      setReviewing(true);
    }
    setHydrated(true);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') navigator.serviceWorker.register('/sw.js');
  }, []);

  useEffect(() => {
    if (!hydrated || reviewing) return;
    localStorage.setItem(KEY, JSON.stringify(state));
    let stale = false;
    setError(null);
    const t = setTimeout(() => {
      discover(state[state.audience]).then((r) => { if (stale) return; setMovies(r.movies); setHasMore(r.hasMore); }).catch((e) => !stale && setError(e.message));
    }, 150);
    return () => { stale = true; clearTimeout(t); };
  }, [state, hydrated, reviewing]);

  const loadMore = async () => {
    if (!movies || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await discover(filters, movies.length);
      setMovies((cur) => {
        const seen = new Set((cur ?? []).map((m) => m.id));
        return [...(cur ?? []), ...r.movies.filter((m) => !seen.has(m.id))];
      });
      setHasMore(r.hasMore);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const applyPreset = (id: string) => {
    const p = PRESETS[audience].find((x) => x.id === id)!;
    const base = freshFilters(audience, filters.country, filters.providers);
    setFilters(filters.preset === id ? base : { ...base, ...p.apply, preset: id });
  };

  const switchAudience = (a: Audience) => { setMovies(null); setState((st) => ({ ...st, audience: a })); };

  return (
    <main className="mx-auto min-h-dvh max-w-xl pb-28 md:max-w-5xl lg:max-w-7xl">
      <header className="sticky top-0 z-30 border-b dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 px-4 pb-3 pt-4 backdrop-blur md:px-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-extrabold text-brand-700 dark:text-brand-500">Akira ✨</h1>
            <p className="text-xs text-slate-500">{audience === 'kids' ? 'Pick a vibe. Watch in under a minute.' : 'Explore cinema from every country, era and language.'}</p>
          </div>
          <div className="flex items-center gap-1">
            <button aria-label="Search films" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => setSearching(true)}>
              <Search className="h-5 w-5" />
            </button>
            <button
              aria-label={view === 'grid' ? 'Show detailed cards' : 'Show compact poster grid'}
              className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
              onClick={() => { const v = view === 'grid' ? 'detail' : 'grid'; setView(v); localStorage.setItem(VIEW_KEY, v); }}
            >
              {view === 'grid' ? <List className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div role="tablist" aria-label="Audience" className="mt-3 grid grid-cols-3 rounded-full bg-slate-100 p-1 dark:bg-slate-800 md:max-w-md">
          {([['kids', '🧒 Kids'], ['adults', '🎬 Adults'], ['review', '🔍 Review']] as const).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={id === 'review' ? reviewing : !reviewing && audience === id}
              onClick={() => { if (id === 'review') setReviewing(true); else { setReviewing(false); switchAudience(id); } }}
              className={cn('min-h-10 rounded-full text-sm font-bold transition',
                (id === 'review' ? reviewing : !reviewing && audience === id) ? 'bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-100' : 'text-slate-500')}>
              {label}
            </button>
          ))}
        </div>
        {!reviewing && <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          {PRESETS[audience].map((p) => (
            <button key={p.id} onClick={() => applyPreset(p.id)} aria-pressed={filters.preset === p.id}
              className={cn('shrink-0 rounded-2xl border px-4 py-2 text-left transition',
                filters.preset === p.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900')}>
              <div className="text-sm font-bold">{p.emoji} {p.label}</div>
              <div className={cn('text-xs', filters.preset === p.id ? 'text-brand-100' : 'text-slate-500')}>{p.sub}</div>
            </button>
          ))}
        </div>}
      </header>

      {reviewing ? (
        <div className="px-4 pt-4 md:px-6"><KidsReview /></div>
      ) : (
        <section className={cn('grid gap-4 px-4 pt-4 md:px-6', view === 'grid' ? 'grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-6' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3')} aria-live="polite">
          {usingMock && <p className="col-span-full rounded-lg bg-amber-50 dark:bg-amber-900/20 p-2 text-xs text-amber-800 dark:text-amber-200">Demo mode: showing 10 sample films. Connect Supabase for the full catalogue.</p>}
          {audience === 'kids' && <p className="col-span-full text-xs text-slate-500">AI tags and community votes can be wrong. Check content and preview films for your child.</p>}
          {error && <p className="col-span-full rounded-lg bg-rose-50 dark:bg-rose-900/20 p-3 text-sm text-rose-800 dark:text-rose-200">Couldn&apos;t load movies: {error}</p>}
          {movies === null && !error && <div className="col-span-full flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>}
          {movies?.length === 0 && (
            <div className="col-span-full mx-auto w-full max-w-xl rounded-2xl border border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-6 text-center">
              <SearchX className="mx-auto h-8 w-8 text-slate-400" />
              <h2 className="mt-2 font-bold">Nothing matches on your apps</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Titles may not match your selected services. You could:</p>
              <ul className="mx-auto mt-2 max-w-xs list-disc pl-5 text-left text-sm text-slate-600 dark:text-slate-300">
                <li>Add another streaming service you have</li>
                <li>Loosen a content slider, language, era or theme filter</li>
                <li>Check legal rent/buy options on your platform's store</li>
                <li>Borrow it free from a local library (Libby, Kanopy, Hoopla)</li>
              </ul>
              <Button variant="outline" className="mt-4" onClick={() => setOpen(true)}>Adjust filters</Button>
            </div>
          )}
          {movies?.map((m) => (view === 'grid' ? <MovieTile key={m.id} m={m} /> : <MovieCard key={m.id} m={m} />))}
          {hasMore && (
            <div className="col-span-full flex justify-center pt-2">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : `Show ${PAGE_SIZE} more`}
              </Button>
            </div>
          )}
          {process.env.NEXT_PUBLIC_REPORT_URL && (
            <p className="col-span-full pt-2 text-center text-xs">
              <a className="text-brand-700 dark:text-brand-100 underline" href={process.env.NEXT_PUBLIC_REPORT_URL} target="_blank" rel="noopener noreferrer">
                Report a wrong rating
              </a>
            </p>
          )}
          <div className="col-span-full flex flex-col items-center gap-2 pt-4 text-center text-[11px] text-slate-400">
            <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">
              <img src="/tmdb-logo.svg" alt="The Movie Database (TMDB)" className="h-3" />
            </a>
            <p>
              Movie data and streaming availability from TMDB / JustWatch. This product uses the TMDB API but is not endorsed or certified by TMDB.
            </p>
          </div>
        </section>
      )}

      {!reviewing && <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-slate-50 dark:from-slate-950 to-transparent px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6">
        <Button className="mx-auto flex w-full max-w-xl shadow-lg md:max-w-sm" onClick={() => setOpen(true)}>
          <SlidersHorizontal className="h-4 w-4" /> {audience === 'kids' ? 'Boundaries & values' : 'Filters'}
        </Button>
      </div>}

      <FilterDrawer open={open} onOpenChange={setOpen} filters={filters} setFilters={setFilters} count={movies?.length ?? 0} more={hasMore} />
      {searching && <SearchPanel audience={audience} onClose={() => {
        setSearching(false);
        const url = new URL(window.location.href);
        url.searchParams.delete('review');
        window.history.replaceState(null, '', url);
      }} />}
    </main>
  );
}
