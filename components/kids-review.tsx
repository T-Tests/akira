'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/discover';
import { Button } from './ui/button';

type ReviewMovie = {
  id: number; tmdb_id: number; title: string; release_year: number | null;
  poster_path: string | null; advisory: string | null;
  approvals: number; rejections: number; my_vote: boolean | null;
};

const PAGE_SIZE = 30;

export function KidsReview() {
  const [tab, setTab] = useState<'pending' | 'rejected' | 'approved'>('pending');
  const [movies, setMovies] = useState<ReviewMovie[]>([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [email, setEmail] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (status: 'pending' | 'rejected' | 'approved', start: number) => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('kids_review_queue', {
      p_status: status, p_limit: PAGE_SIZE + 1, p_offset: start,
    });
    if (error) throw error;
    const rows = data as ReviewMovie[];
    setMovies(rows.slice(0, PAGE_SIZE));
    setMore(rows.length > PAGE_SIZE);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (active && error) setMessage(error.message);
      if (active) setSignedIn(!!data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(!!session));
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    let active = true;
    if (!supabase) return;
    setMovies([]); setMore(false); setLoading(true);
    supabase.rpc('kids_review_queue', { p_status: tab, p_limit: PAGE_SIZE + 1, p_offset: offset })
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error) { setMessage(error.message); return; }
        const rows = data as ReviewMovie[];
        setMovies(rows.slice(0, PAGE_SIZE)); setMore(rows.length > PAGE_SIZE);
      });
    return () => { active = false; };
  }, [tab, offset, signedIn]);

  const sendLink = async () => {
    if (!supabase) return;
    setBusy(true); setMessage(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(), options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}?review=kids` },
      });
      if (error) throw error;
      setMessage('Check your email for a sign-in link. Email verification is required to vote.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not send the sign-in link.');
    } finally { setBusy(false); }
  };

  const vote = async (id: number, approved: boolean) => {
    if (!supabase) return;
    if (!signedIn) { setMessage('Sign in with a verified email before voting.'); return; }
    setBusy(true); setMessage(null);
    try {
      const { error } = await supabase.rpc('vote_kids_movie', { p_movie_id: id, p_approved: approved });
      if (error) throw error;
      await load(tab, offset);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not save your vote.');
    } finally { setBusy(false); }
  };

  if (!supabase) return <p className="text-sm">Community reviews require a connected Supabase project.</p>;
  const client = supabase;
  return (
    <section className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Only vote after watching the film. Community votes are not professional age ratings. A minimum number of approvals and an approval majority are required for Kids.
        A film can move between categories as votes change.
      </p>
      {signedIn ? (
        <Button variant="outline" disabled={busy} onClick={async () => {
          const { error } = await client.auth.signOut();
          if (error) setMessage(error.message);
        }}>Sign out</Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="review-email">Email for voting</label>
          <input id="review-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="Email for voting" className="min-h-11 flex-1 rounded-xl border bg-transparent px-3" />
          <Button disabled={busy || !email.trim()} onClick={sendLink}>Email sign-in link</Button>
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
      <div role="tablist" aria-label="Kids reviews" className="flex gap-2">
        {(['pending', 'rejected', 'approved'] as const).map((value) => (
          <Button key={value} variant={tab === value ? 'primary' : 'outline'} role="tab" aria-selected={tab === value} disabled={busy}
            onClick={() => { setTab(value); setOffset(0); }}>
            {value === 'pending' ? 'Awaiting votes' : value === 'rejected' ? 'More rejections' : 'Approved'}
          </Button>
        ))}
      </div>
      {loading ? <p className="text-sm">Loading reviews…</p> : movies.length === 0 && <p className="text-sm">No films in this category.</p>}
      <ul className="space-y-3">
        {movies.map((m) => (
          <li key={m.id} className="rounded-xl border p-3">
            <p className="font-bold">{m.title} {m.release_year && `(${m.release_year})`}</p>
            <p className="text-sm">{m.advisory ?? 'No advisory available.'}</p>
            <a className="text-sm underline" href={`https://www.themoviedb.org/movie/${m.tmdb_id}`}
              target="_blank" rel="noopener noreferrer">Film details and where to watch</a>
            <p className="my-2 text-sm">{m.approvals} approve · {m.rejections} reject
              {m.my_vote !== null && ` · Your vote: ${m.my_vote ? 'approve' : 'reject'}`}</p>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={() => vote(m.id, true)}>Approve for Kids</Button>
              <Button variant="outline" disabled={busy} onClick={() => vote(m.id, false)}>Not suitable</Button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="outline" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
        <Button variant="outline" disabled={!more || busy} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
      </div>
    </section>
  );
}
