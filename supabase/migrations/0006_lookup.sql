-- On-demand lookup: title search RPC, AI-reviewed status, and a rate-limit log for the edge function.

-- Films fetched on demand are tagged by one model only (stricter prompt) and published as 'ai_reviewed'.
alter table public.movies drop constraint if exists movies_review_status_check;
alter table public.movies add constraint movies_review_status_check
  check (review_status in ('draft','llm_tagged','ai_reviewed','auto_approved','human_verified','rejected'));

-- Fast "best drafts first" for the tagging backlog.
create index if not exists movies_draft_rating_idx on public.movies (tmdb_vote_avg desc nulls last)
  where review_status = 'draft';

-- Service-role only (RLS on, no policies, no grants to the browser roles).
create table if not exists public.lookup_log (
  id          bigint generated always as identity primary key,
  ip_hash     text not null,
  kind        text not null check (kind in ('search','add')),
  tmdb_id     integer,
  created_at  timestamptz not null default now()
);
create index if not exists lookup_log_ip_idx   on public.lookup_log (ip_hash, kind, created_at desc);
create index if not exists lookup_log_time_idx on public.lookup_log (kind, created_at desc);
alter table public.lookup_log enable row level security;
revoke all on table public.lookup_log from anon, authenticated;

-- Title search over published films. Shows every availability type in the user's country,
-- but does not require a streaming match: it is a "does this exist, and where" lookup.
create or replace function public.search_movies(
  p_query   text,
  p_country char(2) default null,
  p_limit   int     default 12
)
returns table (
  id bigint, tmdb_id int, title text, release_year smallint, runtime_min smallint,
  poster_path text, takeaway text, advisory text, recommended_min_age smallint,
  violence smallint, scariness smallint, language smallint,
  sexual_content smallint, mature_themes smallint, lgbtq_themes smallint,
  original_language text, origin_countries char(2)[], is_black_and_white boolean,
  subtitle_languages text[], audience text,
  value_slugs text[], providers jsonb, value_match_score int, review_status text
)
language sql stable security invoker
set search_path = public
as $$
  with q as (
    select trim(p_query) as raw,
           '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select m.id, m.tmdb_id, m.title, m.release_year, m.runtime_min, m.poster_path,
         m.takeaway, m.advisory, m.recommended_min_age,
         cw.violence, cw.scariness, cw.language, cw.sexual_content, cw.mature_themes, cw.lgbtq_themes,
         m.original_language, m.origin_countries, m.is_black_and_white, m.subtitle_languages, m.audience,
         coalesce((select array_agg(iv.slug order by mv.strength desc)
                     from movie_values mv join inspirational_values iv on iv.id = mv.value_id
                    where mv.movie_id = m.id), '{}') as value_slugs,
         coalesce((select jsonb_agg(distinct jsonb_build_object(
                          'provider_id', sc.provider_id, 'name', sp.name,
                          'type', sc.monetization_type, 'link', sc.deep_link))
                     from streaming_cache sc join streaming_providers sp using (provider_id)
                    where sc.movie_id = m.id and sc.country_code = p_country), '[]'::jsonb) as providers,
         0 as value_match_score,
         m.review_status
  from movies m
  join content_warnings cw on cw.movie_id = m.id
  cross join q
  where m.is_published
    and length(q.raw) >= 2
    and (m.title ilike q.pat or m.original_title ilike q.pat)
  order by lower(m.title) = lower(q.raw) desc,
           starts_with(lower(m.title), lower(q.raw)) desc,
           m.tmdb_vote_avg desc nulls last, m.id
  limit least(p_limit, 24);
$$;

revoke execute on function public.search_movies(text, bpchar, int) from public;
grant execute on function public.search_movies(text, bpchar, int) to anon, authenticated;
