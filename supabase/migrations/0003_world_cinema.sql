-- World cinema + Kids/Adults audiences.
-- Adds: audience, origin countries, spoken/subtitle/audio languages, black-and-white flag,
-- audience-scoped value taxonomy, and a new discover_movies() with language/era/B&W/genre filters.

-- ---------- movies ----------
alter table public.movies
  add column audience           text    not null default 'kids' check (audience in ('kids','adults','both')),
  add column origin_countries   char(2)[] not null default '{}',   -- production countries (ISO 3166-1)
  add column spoken_languages   text[]  not null default '{}',     -- ISO 639-1, from TMDB
  add column audio_languages    text[]  not null default '{}',     -- dubs known to exist (curated, optional)
  add column subtitle_languages text[]  not null default '{}',     -- subtitles known to exist (curated, optional)
  add column is_black_and_white boolean not null default false;    -- TMDB keyword "black and white" or curated

create index movies_audience_lang_idx on public.movies (audience, original_language) where is_published;
create index movies_year_idx          on public.movies (release_year) where is_published;
create index movies_bw_idx            on public.movies (audience) where is_published and is_black_and_white;
create index movies_genres_gin_idx    on public.movies using gin (tmdb_genres);

-- ---------- audience-scoped values ----------
alter table public.inspirational_values
  add column audience text not null default 'kids' check (audience in ('kids','adults','both'));

insert into public.inspirational_values (slug, label, description, icon, audience) values
  ('class_society',    'Class & society',        'Wealth, power and how society shapes people',   'landmark',     'adults'),
  ('truth_morality',   'Truth & morality',       'Competing truths, ethical dilemmas',            'scale',        'adults'),
  ('family_belonging', 'Family & belonging',     'Bonds, duty and where we come from',            'home',         'adults'),
  ('love_loss',        'Love & loss',            'Romance, grief and memory',                     'heart',        'adults'),
  ('identity_memory',  'Identity & memory',      'Who we are, where we are from',                 'fingerprint',  'adults'),
  ('resistance',       'Courage & resistance',   'Standing up against oppression or odds',        'shield',       'adults'),
  ('craft',            'Masterful filmmaking',   'Landmark direction, cinematography, editing',   'clapperboard', 'adults')
on conflict (slug) do nothing;

-- ---------- discover_movies v2 ----------
drop function if exists public.discover_movies(
  bpchar, int[], smallint, smallint, smallint, smallint, smallint, smallint, text[], text, smallint, int, int);

create function public.discover_movies(
  p_country           char(2),
  p_providers         int[],
  p_audience          text     default 'kids',   -- 'kids' | 'adults'; films marked 'both' appear in either
  p_max_violence      smallint default 3,
  p_max_scariness     smallint default 3,
  p_max_language      smallint default 3,
  p_max_sexual        smallint default 3,
  p_max_mature        smallint default 3,
  p_max_lgbtq         smallint default 3,
  p_values            text[]   default null,
  p_values_mode       text     default 'any',
  p_max_age           smallint default null,
  p_languages         text[]   default null,     -- original language codes to include (null = any)
  p_exclude_languages text[]   default null,     -- e.g. array['en'] for "world cinema"
  p_year_min          smallint default null,
  p_year_max          smallint default null,
  p_bw_only           boolean  default false,
  p_genres            text[]   default null,     -- any-of, matched against TMDB genre names
  p_limit             int      default 30,
  p_offset            int      default 0
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
language sql stable security invoker
set search_path = public
as $$
  with avail as (
    select sc.movie_id,
           jsonb_agg(distinct jsonb_build_object(
             'provider_id', sc.provider_id, 'name', sp.name,
             'type', sc.monetization_type, 'link', sc.deep_link)) as providers
    from streaming_cache sc
    join streaming_providers sp using (provider_id)
    where sc.country_code = p_country
      and sc.provider_id = any (p_providers)
      and sc.monetization_type in ('flatrate','free','ads')
    group by sc.movie_id
  ),
  matched as (
    select mv.movie_id, count(*)::int as hits, sum(mv.strength)::int as score
    from movie_values mv
    join inspirational_values iv on iv.id = mv.value_id
    where iv.slug = any (p_values)
    group by mv.movie_id
    having p_values_mode <> 'all' or count(*) = cardinality(p_values)
  )
  select m.id, m.tmdb_id, m.title, m.release_year, m.runtime_min, m.poster_path,
         m.takeaway, m.advisory, m.recommended_min_age,
         cw.violence, cw.scariness, cw.language, cw.sexual_content, cw.mature_themes, cw.lgbtq_themes,
         m.original_language, m.origin_countries, m.is_black_and_white, m.subtitle_languages, m.audience,
         (select array_agg(iv.slug order by mv.strength desc)
            from movie_values mv join inspirational_values iv on iv.id = mv.value_id
           where mv.movie_id = m.id) as value_slugs,
         a.providers,
         coalesce(x.score, 0) as value_match_score
  from avail a
  join movies m            on m.id = a.movie_id and m.is_published
  join content_warnings cw on cw.movie_id = m.id
  left join matched x      on x.movie_id = m.id
  where (p_audience is null or m.audience in (p_audience, 'both'))
    and cw.violence       <= p_max_violence
    and cw.scariness      <= p_max_scariness
    and cw.language       <= p_max_language
    and cw.sexual_content <= p_max_sexual
    and cw.mature_themes  <= p_max_mature
    and cw.lgbtq_themes   <= p_max_lgbtq
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
  limit least(p_limit, 50) offset p_offset;
$$;

grant execute on function public.discover_movies to anon, authenticated;
