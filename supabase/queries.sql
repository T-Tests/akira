-- Reference queries. Run in the Supabase SQL editor (after seeding).
-- Scenario: India, Netflix (8) + Prime Video (119) + Disney+ Hotstar (122),
-- gentle content, wants "empathy" AND/OR "teamwork".

-- A. Via the RPC (what the app uses) ---------------------------------------
select * from discover_movies(
  p_country       := 'IN',
  p_audience      := 'kids',
  p_providers     := array[8,119,122],
  p_max_violence  := 1::smallint,
  p_max_scariness := 1::smallint,
  p_max_language  := 0::smallint,
  p_max_sexual    := 0::smallint,
  p_max_mature    := 1::smallint,
  p_max_lgbtq     := 3::smallint,
  p_values        := array['empathy','teamwork'],
  p_values_mode   := 'any'
);

-- A2. Adults: black & white world cinema (not English) from the 1940s-60s
select title, original_language, release_year from discover_movies(
  p_country := 'US', p_providers := array[258,11,1899,8],
  p_audience := 'adults', p_exclude_languages := array['en'],
  p_year_max := 1969::smallint, p_bw_only := true);

-- B. Raw SQL equivalents ---------------------------------------------------
-- B1. ANY of selected values (EXISTS keeps it semi-join, no duplicate rows)
select m.title, cw.*
from movies m
join content_warnings cw on cw.movie_id = m.id
where m.is_published
  and cw.violence <= 1 and cw.scariness <= 1 and cw.language <= 0
  and cw.sexual_content <= 0 and cw.mature_themes <= 1
  and exists (select 1 from streaming_cache sc
               where sc.movie_id = m.id and sc.country_code = 'IN'
                 and sc.provider_id in (8,119,122)
                 and sc.monetization_type in ('flatrate','free','ads'))
  and exists (select 1 from movie_values mv
               join inspirational_values iv on iv.id = mv.value_id
              where mv.movie_id = m.id and iv.slug in ('empathy','teamwork'));

-- B2. ALL of selected values (relational division via GROUP BY/HAVING)
select m.title
from movies m
join content_warnings cw on cw.movie_id = m.id
join movie_values mv on mv.movie_id = m.id
join inspirational_values iv on iv.id = mv.value_id and iv.slug in ('empathy','teamwork')
where m.is_published and cw.violence <= 1 and cw.scariness <= 1
  and exists (select 1 from streaming_cache sc
               where sc.movie_id = m.id and sc.country_code = 'IN'
                 and sc.provider_id in (8,119,122) and sc.monetization_type = 'flatrate')
group by m.id
having count(distinct iv.slug) = 2;

-- C. Verify index usage -----------------------------------------------------
-- explain (analyze, buffers) <query above>;
-- Expect: Index Scan on streaming_cache_pkey (country_code, provider_id) driving the plan.

-- D. Housekeeping: stale availability (>7 days) to refresh ------------------
select distinct movie_id from streaming_cache where fetched_at < now() - interval '7 days';
