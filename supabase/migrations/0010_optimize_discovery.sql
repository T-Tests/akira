-- Speed up discover_movies by avoiding full-table jsonb_agg over streaming_cache.
-- Instead of aggregating all 14,000+ cache rows upfront across all movies in the DB,
-- filter candidates using an indexed EXISTS probe and only aggregate JSON providers
-- for the 25-50 movies in the current page.

create or replace function public.discover_movies(
  p_country char(2), p_providers int[], p_audience text default 'kids',
  p_max_violence smallint default 3, p_max_scariness smallint default 3,
  p_max_language smallint default 3, p_max_sexual smallint default 3,
  p_max_mature smallint default 3, p_max_lgbtq smallint default 3,
  p_values text[] default null, p_values_mode text default 'any',
  p_max_age smallint default null, p_languages text[] default null,
  p_exclude_languages text[] default null, p_year_min smallint default null,
  p_year_max smallint default null, p_bw_only boolean default false,
  p_genres text[] default null, p_limit int default 30, p_offset int default 0
)
returns table (
  id bigint, tmdb_id int, title text, release_year smallint, runtime_min smallint,
  poster_path text, takeaway text, advisory text, recommended_min_age smallint,
  violence smallint, scariness smallint, language smallint,
  sexual_content smallint, mature_themes smallint, lgbtq_themes smallint,
  original_language text, origin_countries char(2)[], is_black_and_white boolean,
  subtitle_languages text[], audience text,
  value_slugs text[], providers jsonb, value_match_score int
)
language sql stable security invoker set search_path = public as $$
  with matched as (
    select mv.movie_id, count(*)::int as hits, sum(mv.strength)::int as score
    from movie_values mv join inspirational_values iv on iv.id = mv.value_id
    where iv.slug = any (p_values) group by mv.movie_id
    having p_values_mode <> 'all' or count(*) = cardinality(p_values)
  ),
  candidates as (
    select m.id, m.tmdb_id, m.title, m.release_year, m.runtime_min, m.poster_path,
      m.takeaway, m.advisory, m.recommended_min_age,
      cw.violence, cw.scariness, cw.language, cw.sexual_content, cw.mature_themes, cw.lgbtq_themes,
      m.original_language, m.origin_countries, m.is_black_and_white, m.subtitle_languages, m.audience,
      m.tmdb_vote_avg,
      coalesce(x.score, 0) as value_match_score
    from movies m
      join content_warnings cw on cw.movie_id = m.id
      left join matched x on x.movie_id = m.id
    where m.is_published
      and (p_audience is null or p_audience = 'adults'
           or (p_audience = 'kids' and m.audience in ('kids', 'both') and m.kids_status in ('approved','legacy')))
      and cw.violence <= p_max_violence and cw.scariness <= p_max_scariness
      and cw.language <= p_max_language and cw.sexual_content <= p_max_sexual
      and cw.mature_themes <= p_max_mature and cw.lgbtq_themes <= p_max_lgbtq
      and (p_max_age is null or m.recommended_min_age is null or m.recommended_min_age <= p_max_age)
      and (coalesce(cardinality(p_values), 0) = 0 or x.movie_id is not null)
      and (coalesce(cardinality(p_languages), 0) = 0 or m.original_language = any (p_languages))
      and (coalesce(cardinality(p_exclude_languages), 0) = 0 or m.original_language is null
        or m.original_language <> all (p_exclude_languages))
      and (p_year_min is null or m.release_year >= p_year_min)
      and (p_year_max is null or m.release_year <= p_year_max)
      and (not coalesce(p_bw_only, false) or m.is_black_and_white)
      and (coalesce(cardinality(p_genres), 0) = 0 or m.tmdb_genres && p_genres)
      and exists (
        select 1 from streaming_cache sc
        where sc.movie_id = m.id
          and (p_country is null or sc.country_code = p_country)
          and sc.provider_id = any (p_providers)
          and sc.monetization_type in ('flatrate','free','ads')
      )
    order by coalesce(x.score, 0) desc, m.tmdb_vote_avg desc nulls last, m.id
    limit least(p_limit, 100) offset p_offset
  )
  select c.id, c.tmdb_id, c.title, c.release_year, c.runtime_min, c.poster_path,
    c.takeaway, c.advisory, c.recommended_min_age,
    c.violence, c.scariness, c.language, c.sexual_content, c.mature_themes, c.lgbtq_themes,
    c.original_language, c.origin_countries, c.is_black_and_white, c.subtitle_languages, c.audience,
    coalesce((select array_agg(iv.slug order by mv.strength desc)
      from movie_values mv join inspirational_values iv on iv.id = mv.value_id
      where mv.movie_id = c.id), '{}'::text[]) as value_slugs,
    coalesce((
      select jsonb_agg(distinct jsonb_build_object('provider_id', sc.provider_id, 'name', sp.name,
        'type', sc.monetization_type, 'link', sc.deep_link, 'country', sc.country_code))
      from streaming_cache sc join streaming_providers sp using (provider_id)
      where sc.movie_id = c.id
        and (p_country is null or sc.country_code = p_country)
        and sc.provider_id = any (p_providers)
        and sc.monetization_type in ('flatrate','free','ads')
    ), '[]'::jsonb) as providers,
    c.value_match_score
  from candidates c
  order by c.value_match_score desc, c.tmdb_vote_avg desc nulls last, c.id;
$$;

grant execute on function public.discover_movies to anon, authenticated;

