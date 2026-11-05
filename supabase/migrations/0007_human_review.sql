-- In-app human review of films the two AI passes disagreed on (review_status = 'llm_tagged').
-- Unpublished rows are hidden by RLS, so these SECURITY DEFINER RPCs are the only browser path.

create or replace function public.list_review_movies(p_limit int default 20, p_offset int default 0)
returns table (
  id bigint, tmdb_id int, title text, release_year smallint, runtime_min smallint,
  poster_path text, overview text, takeaway text, advisory text, recommended_min_age smallint,
  violence smallint, scariness smallint, language smallint,
  sexual_content smallint, mature_themes smallint, lgbtq_themes smallint,
  original_language text, audience text, value_slugs text[]
)
language sql stable security definer
set search_path = public
as $$
  select m.id, m.tmdb_id, m.title, m.release_year, m.runtime_min, m.poster_path, m.overview,
         m.takeaway, m.advisory, m.recommended_min_age,
         cw.violence, cw.scariness, cw.language, cw.sexual_content, cw.mature_themes, cw.lgbtq_themes,
         m.original_language, m.audience,
         coalesce((select array_agg(iv.slug order by mv.strength desc)
                     from movie_values mv join inspirational_values iv on iv.id = mv.value_id
                    where mv.movie_id = m.id), '{}')
  from movies m
  join content_warnings cw on cw.movie_id = m.id
  where m.review_status = 'llm_tagged' and not m.is_published
  order by m.tmdb_vote_avg desc nulls last, m.id
  limit least(p_limit, 50) offset p_offset;
$$;

-- Approve a film for 'kids' or 'adults': sets its audience, publishes it and marks it human-verified.
create or replace function public.review_movie(p_tmdb_id int, p_audience text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare n int;
begin
  if p_audience not in ('kids', 'adults') then
    raise exception 'audience must be kids or adults';
  end if;
  update movies
     set audience = p_audience, review_status = 'human_verified', is_published = true
   where tmdb_id = p_tmdb_id and review_status = 'llm_tagged' and not is_published;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke execute on function public.list_review_movies(int, int) from public;
revoke execute on function public.review_movie(int, text) from public;
grant execute on function public.list_review_movies(int, int) to anon, authenticated;
grant execute on function public.review_movie(int, text) to anon, authenticated;
