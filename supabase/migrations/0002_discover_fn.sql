-- Single-call discovery RPC. Call from the frontend with supabase.rpc('discover_movies', {...}).
-- p_values_mode: 'any' = movie has at least one selected value, 'all' = has every selected value.
-- NULL / empty p_values => no value filter. Max params default to 3 (= no restriction).
create or replace function public.discover_movies(
  p_country        char(2),
  p_providers      int[],
  p_max_violence   smallint default 3,
  p_max_scariness  smallint default 3,
  p_max_language   smallint default 3,
  p_max_sexual     smallint default 3,
  p_max_mature     smallint default 3,
  p_max_lgbtq      smallint default 3,
  p_values         text[]   default null,
  p_values_mode    text     default 'any',
  p_max_age        smallint default null,   -- hide films whose recommended_min_age exceeds this
  p_limit          int      default 20,
  p_offset         int      default 0
)
returns table (
  id bigint, tmdb_id int, title text, release_year smallint, runtime_min smallint,
  poster_path text, takeaway text, advisory text, recommended_min_age smallint,
  violence smallint, scariness smallint, language smallint,
  sexual_content smallint, mature_themes smallint, lgbtq_themes smallint,
  value_slugs text[], providers jsonb, value_match_score int
)
language sql stable security invoker
set search_path = public
as $$
  with avail as (                       -- 1. cheapest, most selective filter first
    select sc.movie_id,
           jsonb_agg(distinct jsonb_build_object(
             'provider_id', sc.provider_id, 'name', sp.name,
             'type', sc.monetization_type, 'link', sc.deep_link)) as providers
    from streaming_cache sc
    join streaming_providers sp using (provider_id)
    where sc.country_code = p_country
      and sc.provider_id = any (p_providers)
      and sc.monetization_type in ('flatrate','free','ads')   -- exclude rent/buy by default
    group by sc.movie_id
  ),
  matched as (                          -- 2. value filter (ANY / ALL) with a relevance score
    select mv.movie_id,
           count(*)::int as hits,
           sum(mv.strength)::int as score
    from movie_values mv
    join inspirational_values iv on iv.id = mv.value_id
    where iv.slug = any (p_values)
    group by mv.movie_id
    having p_values_mode <> 'all' or count(*) = cardinality(p_values)
  )
  select m.id, m.tmdb_id, m.title, m.release_year, m.runtime_min, m.poster_path,
         m.takeaway, m.advisory, m.recommended_min_age,
         cw.violence, cw.scariness, cw.language, cw.sexual_content, cw.mature_themes, cw.lgbtq_themes,
         (select array_agg(iv.slug order by mv.strength desc)
            from movie_values mv join inspirational_values iv on iv.id = mv.value_id
           where mv.movie_id = m.id) as value_slugs,
         a.providers,
         coalesce(x.score, 0) as value_match_score
  from avail a
  join movies m            on m.id = a.movie_id and m.is_published
  join content_warnings cw on cw.movie_id = m.id
  left join matched x      on x.movie_id = m.id
  where cw.violence       <= p_max_violence
    and cw.scariness      <= p_max_scariness
    and cw.language       <= p_max_language
    and cw.sexual_content <= p_max_sexual
    and cw.mature_themes  <= p_max_mature
    and cw.lgbtq_themes   <= p_max_lgbtq
    and (p_max_age is null or m.recommended_min_age is null or m.recommended_min_age <= p_max_age)
    and (coalesce(cardinality(p_values), 0) = 0 or x.movie_id is not null)
  order by coalesce(x.score, 0) desc, m.tmdb_vote_avg desc nulls last, m.id
  limit least(p_limit, 50) offset p_offset;
$$;

grant execute on function public.discover_movies to anon, authenticated;
