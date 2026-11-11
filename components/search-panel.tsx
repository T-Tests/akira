'use client';
import { useEffect, useState } from 'react';
import { LayoutGrid, List, Loader2, Search, X } from 'lucide-react';
import { Button } from './ui/button';
import { MovieCard } from './movie-card';
import { MovieTile } from './movie-tile';
import { KidsReview } from './kids-review';
import { addFromTmdb, searchLibrary, searchTmdb } from '@/lib/lookup';
import { usingMock } from '@/lib/discover';
import type { Audience, MovieResult, TmdbCandidate } from '@/lib/types';

export function SearchPanel({
  audience,
  initialReview = false,
  onClose,
  userProviders,
  initialView = 'detail',
}: {
  audience: Audience;
  initialReview?: boolean;
  onClose: () => void;
  userProviders?: number[];
  initialView?: 'detail' | 'grid';
}) {
  const [tab, setTab] = useState<'search' | 'review'>(initialReview ? 'review' : 'search');
  const [view, setView] = useState<'detail' | 'grid'>(initialView);
  const [q, setQ] = useState('');
  const [library, setLibrary] = useState<MovieResult[] | null>(null);
  const [candidates, setCandidates] = useState<TmdbCandidate[] | null>(null);
  const [busy, setBusy] = useState<number | 'tmdb' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCandidates(null); setError(null);
    if (q.trim().length < 2) { setLibrary(null); return; }
    let stale = false;
    const t = setTimeout(() => {
      searchLibrary(q, audience, userProviders).then((r) => !stale && setLibrary(r)).catch((e) => !stale && setError(e.message));
    }, 300);
    return () => { stale = true; clearTimeout(t); };
  }, [q, audience, userProviders]);

  const run = async <T,>(key: number | 'tmdb', fn: () => Promise<T>, ok: (r: T) => void | Promise<void>) => {
    setBusy(key); setError(null);
    try { await ok(await fn()); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const add = (c: TmdbCandidate) =>
    run(c.tmdb_id, () => addFromTmdb(c.tmdb_id), async () => {
      setCandidates(null);
      setLibrary(await searchLibrary(c.title, audience, userProviders));
      setQ(c.title);
      if (audience === 'kids') setTab('review');
    });

  return (
    <div role="dialog" aria-label="Search films" className="fixed inset-0 z-50 overflow-y-auto bg-white dark:bg-slate-950">
      <div className="mx-auto max-w-xl px-4 pb-16 pt-4 md:max-w-5xl md:px-6">
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-white pb-3 dark:bg-slate-950">
          <Search className="h-5 w-5 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any film…"
            className="min-h-11 flex-1 rounded-xl border border-slate-300 bg-transparent px-3 dark:border-slate-600" />
          <button
            aria-label={view === 'grid' ? 'Show detailed cards' : 'Show compact poster grid'}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setView((v) => (v === 'grid' ? 'detail' : 'grid'))}
          >
            {view === 'grid' ? <List className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
          </button>
          <button aria-label="Close search" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && <p className="mb-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-900/20 dark:text-rose-200">{error}</p>}
        <div role="tablist" aria-label="Search and community review" className="my-4 flex gap-2">
          <Button role="tab" aria-selected={tab === 'search'} variant={tab === 'search' ? 'primary' : 'outline'} onClick={() => setTab('search')}>Search</Button>
          <Button role="tab" aria-selected={tab === 'review'} variant={tab === 'review' ? 'primary' : 'outline'} onClick={() => setTab('review')}>Kids reviews</Button>
        </div>
        {tab === 'review' ? <KidsReview /> : <>

        {library && (
          <>
            {view === 'grid' ? (
              <div className="grid grid-cols-3 gap-3 md:grid-cols-4 lg:grid-cols-6">
                {library.map((m) => <MovieTile key={m.id} m={m} />)}
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {library.map((m) => <MovieCard key={m.id} m={m} />)}
              </div>
            )}
            {library.length === 0 && <p className="py-4 text-center text-sm text-slate-500">No match in our catalogue yet.</p>}
            {!usingMock && (
              <div className="py-4 text-center">
                <Button variant="outline" disabled={busy === 'tmdb'} onClick={() => run('tmdb', () => searchTmdb(q), setCandidates)}>
                  {busy === 'tmdb' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Not finding it? Search TMDB'}
                </Button>
              </div>
            )}
          </>
        )}

        {candidates && (
          <ul className="space-y-2">
            {candidates.every((c) => c.ready) && <li className="text-center text-sm text-slate-500">No new titles to review.</li>}
            {candidates.filter((c) => !c.ready).map((c) => (
              <li key={c.tmdb_id} className="flex gap-3 rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.poster_path && <img src={`https://image.tmdb.org/t/p/w92${c.poster_path}`} alt="" className="h-20 w-14 rounded object-cover" />}
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{c.title} <span className="font-normal text-slate-500">{c.year}</span></p>
                  <p className="line-clamp-2 text-xs text-slate-500">{c.overview}</p>
                </div>
                <Button disabled={busy !== null} onClick={() => add(c)}>
                  {busy === c.tmdb_id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Review with AI'}
                </Button>
              </li>
            ))}
            {busy !== null && typeof busy === 'number' && <li className="text-center text-xs text-slate-500">Reviewing… this can take up to a minute.</li>}
          </ul>
        )}
        <p className="pt-6 text-center text-[11px] text-slate-400">Films you add appear in Adults after AI tagging. Kids-eligible films require community approval.</p>
        </>}
      </div>
    </div>
  );
}
