-- Adults and Kids have independent publication states. Existing published Kids
-- films retain their previous visibility; new films need community approval.
-- The old anonymous one-click review must not bypass community voting.
revoke execute on function public.review_movie(int, text) from public, anon, authenticated;
revoke execute on function public.list_review_movies(int, int) from public, anon, authenticated;

alter table public.movies add column kids_status text not null default 'pending'
  check (kids_status in ('pending', 'approved', 'rejected', 'legacy'));
update public.movies set kids_status = 'legacy'
where is_published and audience in ('kids', 'both');
update public.content_warnings cw set confidence = null
from public.movies m where m.id = cw.movie_id and m.audience = 'adults';

create table public.kids_review_settings (
  id boolean primary key default true check (id),
  approval_threshold integer not null default 5 check (approval_threshold > 0)
);
insert into public.kids_review_settings (id) values (true);

create table public.kids_votes (
  movie_id bigint not null references public.movies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  approved boolean not null,
  updated_at timestamptz not null default now(),
  primary key (movie_id, user_id)
);
create index kids_votes_user_updated_idx on public.kids_votes (user_id, updated_at desc);
create table public.kids_vote_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index kids_vote_events_user_time_idx on public.kids_vote_events (user_id, created_at);
alter table public.kids_votes enable row level security;
alter table public.kids_review_settings enable row level security;
alter table public.kids_vote_events enable row level security;
revoke all on public.kids_votes, public.kids_review_settings, public.kids_vote_events from public, anon, authenticated;

create function public.recalculate_kids_status(p_movie_id bigint) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_approvals integer;
  v_rejections integer;
  v_threshold integer;
begin
  perform 1 from public.movies where id = p_movie_id for update;
  select count(*) filter (where approved), count(*) filter (where not approved)
    into v_approvals, v_rejections from public.kids_votes where movie_id = p_movie_id;
  select approval_threshold into strict v_threshold from public.kids_review_settings where id;
  update public.movies set kids_status = case
    when v_approvals >= v_threshold and v_approvals > v_rejections then 'approved'
    when v_rejections > v_approvals then 'rejected'
    else 'pending' end
  where id = p_movie_id and kids_status <> 'legacy';
end $$;
revoke all on function public.recalculate_kids_status(bigint) from public, anon, authenticated;

create function public.recalculate_deleted_vote() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.recalculate_kids_status(old.movie_id);
  return old;
end $$;
create trigger kids_vote_deleted after delete on public.kids_votes
  for each row execute function public.recalculate_deleted_vote();

create function public.recalculate_threshold() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  for r in select id from public.movies where kids_status in ('approved','pending','rejected')
    and audience in ('kids','both') and is_published order by id
  loop perform public.recalculate_kids_status(r.id); end loop;
  return new;
end $$;
create trigger kids_threshold_changed after update of approval_threshold on public.kids_review_settings
  for each row when (old.approval_threshold is distinct from new.approval_threshold)
  execute function public.recalculate_threshold();

-- A per-movie lock serializes votes and state changes; no browser can write the
-- vote table or movie state directly. Email confirmation is checked server-side.
create function public.vote_kids_movie(p_movie_id bigint, p_approved boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_movie public.movies%rowtype;
begin
  if v_user is null or not exists (
    select 1 from auth.users u where u.id = v_user and u.email_confirmed_at is not null
  ) then raise exception 'A verified email account is required'; end if;
  if p_approved is null then raise exception 'A vote is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 0));
  select * into v_movie from public.movies where id = p_movie_id for update;
  if not found or not v_movie.is_published or v_movie.audience not in ('kids', 'both')
     or v_movie.kids_status = 'legacy' then
    raise exception 'This movie is not available for community review';
  end if;
  delete from public.kids_vote_events where user_id = v_user and created_at <= now() - interval '1 hour';
  if (select count(*) from public.kids_vote_events where user_id = v_user) >= 60 then
    raise exception 'Review limit reached; try again later';
  end if;
  insert into public.kids_vote_events (user_id) values (v_user);
  insert into public.kids_votes (movie_id, user_id, approved)
  values (p_movie_id, v_user, p_approved)
  on conflict (movie_id, user_id) do update
    set approved = excluded.approved, updated_at = now();
  perform public.recalculate_kids_status(p_movie_id);
end $$;
revoke all on function public.vote_kids_movie(bigint, boolean) from public, anon;
grant execute on function public.vote_kids_movie(bigint, boolean) to authenticated;

create function public.kids_review_queue(p_status text, p_limit integer default 30, p_offset integer default 0)
returns table (id bigint, tmdb_id integer, title text, release_year smallint,
  poster_path text, advisory text, approvals bigint, rejections bigint, my_vote boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.id, m.tmdb_id, m.title, m.release_year, m.poster_path, m.advisory,
         count(v.user_id) filter (where v.approved),
         count(v.user_id) filter (where not v.approved),
         bool_or(v.approved) filter (where v.user_id = auth.uid())
  from public.movies m left join public.kids_votes v on v.movie_id = m.id
  where m.is_published and m.audience in ('kids', 'both')
    and p_status in ('pending', 'rejected', 'approved') and m.kids_status = p_status
  group by m.id order by m.id
  limit least(greatest(p_limit, 1), 50) offset greatest(p_offset, 0)
$$;
revoke all on function public.kids_review_queue(text, integer, integer) from public;
grant execute on function public.kids_review_queue(text, integer, integer) to anon, authenticated;
