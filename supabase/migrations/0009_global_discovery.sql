-- NULL country requests global offers. Keep the existing RPC signature so
-- cached clients can continue requesting a specific country.
create index streaming_cache_provider_movie_idx on public.streaming_cache (provider_id, movie_id);

create function public.replace_movie_availability(p_movie_id bigint, p_offers jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if jsonb_typeof(p_offers) is distinct from 'array' then raise exception 'Offers must be an array'; end if;
  if not exists (select 1 from public.movies where id = p_movie_id) then raise exception 'Movie not found'; end if;
  delete from public.streaming_cache where movie_id = p_movie_id;
  insert into public.streaming_cache (movie_id, country_code, provider_id, monetization_type, deep_link, fetched_at)
  select p_movie_id, o.country_code, o.provider_id, o.monetization_type, o.deep_link, o.fetched_at
  from jsonb_to_recordset(p_offers) as o(country_code char(2), provider_id integer,
    monetization_type text, deep_link text, fetched_at timestamptz);
end $$;
revoke all on function public.replace_movie_availability(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.replace_movie_availability(bigint, jsonb) to service_role;

-- A tag, its values and publication state must commit together. The row lock
-- also prevents a concurrent manual withdrawal from being overwritten.
create function public.complete_movie_tagging(p_movie_id bigint, p_tag jsonb, p_model text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_movie public.movies%rowtype;
  v_value_count integer;
begin
  select * into strict v_movie from public.movies where id = p_movie_id for update;
  if v_movie.review_status <> 'draft' then raise exception 'Movie state changed during tagging'; end if;
  if (p_tag->>'tmdb_id')::integer is distinct from v_movie.tmdb_id then raise exception 'TMDB ID mismatch'; end if;
  if jsonb_typeof(p_tag->'values') is distinct from 'array' then raise exception 'Invalid values'; end if;
  select count(*) into v_value_count from jsonb_to_recordset(p_tag->'values') as t(slug text, strength int)
    join public.inspirational_values iv on iv.slug = t.slug;
  if v_value_count <> jsonb_array_length(p_tag->'values') then raise exception 'Unknown value tag'; end if;
  insert into public.content_warnings (movie_id, violence, scariness, language, sexual_content,
    mature_themes, lgbtq_themes, notes, source, confidence, tagged_by, tagged_at)
  values (p_movie_id, (p_tag->>'violence')::smallint, (p_tag->>'scariness')::smallint,
    (p_tag->>'language')::smallint, (p_tag->>'sexual_content')::smallint,
    (p_tag->>'mature_themes')::smallint, (p_tag->>'lgbtq_themes')::smallint,
    coalesce(p_tag->'notes', '{}'::jsonb), 'llm',
    case when v_movie.audience = 'adults' then null else (p_tag->>'confidence')::numeric end, p_model, now())
  on conflict (movie_id) do update set violence = excluded.violence, scariness = excluded.scariness,
    language = excluded.language, sexual_content = excluded.sexual_content,
    mature_themes = excluded.mature_themes, lgbtq_themes = excluded.lgbtq_themes,
    notes = excluded.notes, source = excluded.source, confidence = excluded.confidence,
    tagged_by = excluded.tagged_by, tagged_at = excluded.tagged_at;
  delete from public.movie_values where movie_id = p_movie_id;
  insert into public.movie_values (movie_id, value_id, strength)
    select p_movie_id, iv.id, t.strength
    from jsonb_to_recordset(p_tag->'values') as t(slug text, strength int)
    join public.inspirational_values iv on iv.slug = t.slug;
  update public.movies set takeaway = p_tag->>'takeaway', advisory = p_tag->>'advisory',
    recommended_min_age = (p_tag->>'recommended_min_age')::smallint,
    review_status = 'ai_reviewed', is_published = true where id = p_movie_id;
end $$;
revoke all on function public.complete_movie_tagging(bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.complete_movie_tagging(bigint, jsonb, text) to service_role;

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
  with avail as (
    select sc.movie_id,
      jsonb_agg(distinct jsonb_build_object('provider_id', sc.provider_id, 'name', sp.name,
        'type', sc.monetization_type, 'link', sc.deep_link, 'country', sc.country_code)) as providers
    from streaming_cache sc join streaming_providers sp using (provider_id)
    where (p_country is null or sc.country_code = p_country)
      and sc.provider_id = any (p_providers) and sc.monetization_type in ('flatrate','free','ads')
    group by sc.movie_id
  ), matched as (
    select mv.movie_id, count(*)::int as hits, sum(mv.strength)::int as score
    from movie_values mv join inspirational_values iv on iv.id = mv.value_id
    where iv.slug = any (p_values) group by mv.movie_id
    having p_values_mode <> 'all' or count(*) = cardinality(p_values)
  )
  select m.id, m.tmdb_id, m.title, m.release_year, m.runtime_min, m.poster_path,
    m.takeaway, m.advisory, m.recommended_min_age,
    cw.violence, cw.scariness, cw.language, cw.sexual_content, cw.mature_themes, cw.lgbtq_themes,
    m.original_language, m.origin_countries, m.is_black_and_white, m.subtitle_languages, m.audience,
    coalesce((select array_agg(iv.slug order by mv.strength desc)
      from movie_values mv join inspirational_values iv on iv.id = mv.value_id
      where mv.movie_id = m.id), '{}'::text[]),
    a.providers, coalesce(x.score, 0)
  from avail a join movies m on m.id = a.movie_id and m.is_published
    join content_warnings cw on cw.movie_id = m.id
    left join matched x on x.movie_id = m.id
  where (p_audience is null or p_audience = 'adults'
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
  order by coalesce(x.score, 0) desc, m.tmdb_vote_avg desc nulls last, m.id
  limit least(p_limit, 50) offset p_offset
$$;

create function public.search_movies_for_audience(p_query text, p_audience text, p_limit int default 12)
returns table (
  id bigint, tmdb_id int, title text, release_year smallint, runtime_min smallint,
  poster_path text, takeaway text, advisory text, recommended_min_age smallint,
  violence smallint, scariness smallint, language smallint,
  sexual_content smallint, mature_themes smallint, lgbtq_themes smallint,
  original_language text, origin_countries char(2)[], is_black_and_white boolean,
  subtitle_languages text[], audience text, value_slugs text[], providers jsonb,
  value_match_score int, review_status text
)
language sql stable security invoker set search_path = public as $$
  with q as (
    select trim(p_query) as raw,
      '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select m.id, m.tmdb_id, m.title, m.release_year, m.runtime_min, m.poster_path,
    m.takeaway, m.advisory, m.recommended_min_age,
    cw.violence, cw.scariness, cw.language, cw.sexual_content, cw.mature_themes, cw.lgbtq_themes,
    m.original_language, m.origin_countries, m.is_black_and_white, m.subtitle_languages, m.audience,
    coalesce((select array_agg(iv.slug order by mv.strength desc) from movie_values mv
      join inspirational_values iv on iv.id = mv.value_id where mv.movie_id = m.id), '{}'::text[]),
    coalesce((select jsonb_agg(distinct jsonb_build_object(
      'provider_id', sc.provider_id, 'name', sp.name, 'type', sc.monetization_type,
      'link', sc.deep_link, 'country', sc.country_code))
      from streaming_cache sc join streaming_providers sp using (provider_id)
      where sc.movie_id = m.id), '[]'::jsonb), 0, m.review_status
  from movies m join content_warnings cw on cw.movie_id = m.id cross join q
  where m.is_published and length(q.raw) >= 2
    and (m.title ilike q.pat or m.original_title ilike q.pat)
    and (p_audience = 'adults' or
      (p_audience = 'kids' and m.audience in ('kids', 'both') and m.kids_status in ('approved','legacy')))
  order by lower(m.title) = lower(q.raw) desc, starts_with(lower(m.title), lower(q.raw)) desc,
    m.tmdb_vote_avg desc nulls last, m.id
  limit least(greatest(p_limit, 1), 24)
$$;
revoke all on function public.search_movies_for_audience(text, text, integer) from public;
grant execute on function public.search_movies_for_audience(text, text, integer) to anon, authenticated;

create or replace function public.search_movies(p_query text, p_country char(2) default null, p_limit int default 12)
returns table (
  id bigint, tmdb_id int, title text, release_year smallint, runtime_min smallint,
  poster_path text, takeaway text, advisory text, recommended_min_age smallint,
  violence smallint, scariness smallint, language smallint,
  sexual_content smallint, mature_themes smallint, lgbtq_themes smallint,
  original_language text, origin_countries char(2)[], is_black_and_white boolean,
  subtitle_languages text[], audience text, value_slugs text[], providers jsonb,
  value_match_score int, review_status text
)
language sql stable security invoker set search_path = public as $$
  with q as (
    select trim(p_query) as raw,
      '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select m.id, m.tmdb_id, m.title, m.release_year, m.runtime_min, m.poster_path,
    m.takeaway, m.advisory, m.recommended_min_age,
    cw.violence, cw.scariness, cw.language, cw.sexual_content, cw.mature_themes, cw.lgbtq_themes,
    m.original_language, m.origin_countries, m.is_black_and_white, m.subtitle_languages, m.audience,
    coalesce((select array_agg(iv.slug order by mv.strength desc) from movie_values mv
      join inspirational_values iv on iv.id = mv.value_id where mv.movie_id = m.id), '{}'::text[]),
    coalesce((select jsonb_agg(distinct jsonb_build_object(
      'provider_id', sc.provider_id, 'name', sp.name, 'type', sc.monetization_type,
      'link', sc.deep_link, 'country', sc.country_code))
      from streaming_cache sc join streaming_providers sp using (provider_id)
      where sc.movie_id = m.id and (p_country is null or sc.country_code = p_country)), '[]'::jsonb),
    0, m.review_status
  from movies m join content_warnings cw on cw.movie_id = m.id cross join q
  where m.is_published and length(q.raw) >= 2
    and (m.title ilike q.pat or m.original_title ilike q.pat)
  order by lower(m.title) = lower(q.raw) desc, starts_with(lower(m.title), lower(q.raw)) desc,
    m.tmdb_vote_avg desc nulls last, m.id
  limit least(p_limit, 24)
$$;
