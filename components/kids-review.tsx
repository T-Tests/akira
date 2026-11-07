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

function ReviewMovieItem({ m, busy, vote }: { m: ReviewMovie; busy: boolean; vote: (id: number, approved: boolean) => void }) {
  const [imgOk, setImgOk] = useState(true);
  return (
    <li className="flex gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 shadow-sm">
      <div className="h-32 w-20 shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-700">
        {imgOk && m.poster_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`https://image.tmdb.org/t/p/w185${m.poster_path}`}
            alt={`${m.title} poster`}
            loading="lazy"
            onError={() => setImgOk(false)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-1 text-center text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {m.title}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{m.title} {m.release_year && `(${m.release_year})`}</p>
        <p className="text-sm text-slate-600 dark:text-slate-300">{m.advisory ?? 'No advisory available.'}</p>
        <a className="text-sm underline text-brand-700 dark:text-brand-300" href={`https://www.themoviedb.org/movie/${m.tmdb_id}`}
          target="_blank" rel="noopener noreferrer">Film details and where to watch</a>
        <p className="my-2 text-sm text-slate-600 dark:text-slate-400">{m.approvals} approve · {m.rejections} reject
          {m.my_vote !== null && ` · Your vote: ${m.my_vote ? 'approve' : 'reject'}`}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => vote(m.id, true)}>Approve for Kids</Button>
          <Button variant="outline" disabled={busy} onClick={() => vote(m.id, false)}>Not suitable</Button>
        </div>
      </div>
    </li>
  );
}

export function KidsReview() {
  const [tab, setTab] = useState<'pending' | 'rejected' | 'approved'>('pending');
  const [movies, setMovies] = useState<ReviewMovie[]>([]);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
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

    // Handle PKCE code exchange if redirected from magic link
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
      setBusy(true);
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (!active) return;
        setBusy(false);
        if (error) {
          setMessage(`Sign-in link error: ${error.message}`);
        } else if (data.session) {
          setSignedIn(true);
          setMessage('Signed in successfully!');
          const url = new URL(window.location.href);
          url.searchParams.delete('code');
          window.history.replaceState(null, '', url);
        }
      });
    }

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
      if (error) {
        if (error.message?.includes('confirmation email') || (error as any).status === 500) {
          throw new Error('Supabase email service failed to send the email (500). Please ensure Custom SMTP is enabled and configured in your Supabase Dashboard (Authentication -> Email Settings / SMTP).');
        }
        throw error;
      }
      setOtpSent(true);
      setMessage('Check your email for a sign-in link or verification code. You can enter the code below or click the link.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not send the sign-in link.');
    } finally { setBusy(false); }
  };

  const verifyCode = async () => {
    if (!supabase || !otp.trim() || !email.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: email.trim(), token: otp.trim(), type: 'email',
      });
      if (error) throw error;
      if (data.session) {
        setSignedIn(true);
        setOtpSent(false);
        setOtp('');
        setMessage('Signed in successfully!');
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Invalid code.');
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
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Signed in</span>
          <Button variant="outline" disabled={busy} onClick={async () => {
            const { error } = await client.auth.signOut();
            if (error) setMessage(error.message);
          }}>Sign out</Button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="review-email">Email for voting</label>
            <input id="review-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="Email for voting" className="min-h-11 flex-1 rounded-xl border bg-transparent px-3" />
            <Button disabled={busy || !email.trim()} onClick={sendLink}>Send sign-in link / code</Button>
          </div>
          {otpSent && (
            <div className="flex flex-wrap gap-2">
              <label className="sr-only" htmlFor="review-otp">Verification code</label>
              <input id="review-otp" type="text" value={otp} onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter 6-8 digit code from email" className="min-h-11 flex-1 rounded-xl border bg-transparent px-3" />
              <Button disabled={busy || !otp.trim()} onClick={verifyCode}>Verify code</Button>
            </div>
          )}
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
          <ReviewMovieItem key={m.id} m={m} busy={busy} vote={vote} />
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="outline" disabled={offset === 0 || busy} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</Button>
        <Button variant="outline" disabled={!more || busy} onClick={() => setOffset(offset + PAGE_SIZE)}>Next</Button>
      </div>
    </section>
  );
}
