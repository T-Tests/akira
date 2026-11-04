-- Akira schema (Supabase / PostgreSQL 15+)
-- Design notes:
--  * content_warnings is WIDE (one row per movie, one smallint per category) so
--    "max severity" filters are plain B-tree-friendly comparisons, no pivoting.
--  * streaming_cache is the hot filter (country + provider) -> drives the query plan.
--  * Discovery is exposed through one RPC (discover_movies) so the Cloudflare-hosted
--    frontend makes ONE subrequest per search (Workers free plan: 50 subrequests, 10ms CPU).

create extension if not exists pg_trgm;

-- ---------- Core ----------
create table public.movies (
  id              bigint generated always as identity primary key,
  tmdb_id         integer not null unique,
  imdb_id         text,
  title           text not null,
  original_title  text,
  release_year    smallint,
  runtime_min     smallint,
  overview        text,
  poster_path     text,                       -- TMDB relative path; build URL client-side
  backdrop_path   text,
  original_language text,
  tmdb_vote_avg   numeric(3,1),
  tmdb_genres     text[] not null default '{}',
  recommended_min_age smallint check (recommended_min_age between 0 and 18),
  takeaway        text,                       -- "Why Watch" (<= 2 sentences, spoiler-free)
  advisory        text,                       -- "What to Know" (<= 2 sentences)
  review_status   text not null default 'draft'
                    check (review_status in ('draft','llm_tagged','human_verified','rejected')),
  is_published    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index movies_published_idx on public.movies (is_published) where is_published;
create index movies_title_trgm_idx on public.movies using gin (title gin_trgm_ops);

-- ---------- Content warnings (0 = none .. 3 = severe) ----------
-- violence:  0 none, 1 slapstick/cartoon, 2 mild peril/conflict, 3 realistic/graphic
-- scariness: 0 none, 1 mildly tense, 2 jump scares/frightening scenes, 3 intense/disturbing
-- language:  0 none, 1 name-calling/mild, 2 moderate profanity, 3 strong/explicit
-- sexual_content: 0 none, 1 kissing/romance, 2 innuendo/suggestive, 3 nudity/explicit
-- mature_themes: 0 none, 1 light (bullying, loss), 2 serious (death, divorce), 3 heavy (abuse, war, suicide)
-- lgbtq_themes: 0 none, 1 brief/background, 2 notable, 3 central  (neutral flag; parents choose)
create table public.content_warnings (
  movie_id        bigint primary key references public.movies(id) on delete cascade,
  violence        smallint not null default 0 check (violence        between 0 and 3),
  scariness       smallint not null default 0 check (scariness       between 0 and 3),
  language        smallint not null default 0 check (language        between 0 and 3),
  sexual_content  smallint not null default 0 check (sexual_content  between 0 and 3),
  mature_themes   smallint not null default 0 check (mature_themes   between 0 and 3),
  lgbtq_themes    smallint not null default 0 check (lgbtq_themes    between 0 and 3),
  -- optional per-category specifics, e.g. {"scariness":"Villain chase in the forest, ~min 52"}
  notes           jsonb not null default '{}'::jsonb,
  source          text not null default 'llm' check (source in ('llm','curated','crowd')),
  confidence      numeric(3,2),
  tagged_by       text,                       -- e.g. 'gemini-2.5-flash'; null for curated/crowd
  tagged_at       timestamptz,
  updated_at      timestamptz not null default now()
);
-- Compound index for the most common "strict" filter combo (covers index-only scans).
create index content_warnings_filter_idx on public.content_warnings
  (violence, scariness, language, sexual_content, mature_themes, lgbtq_themes) include (movie_id);

-- ---------- Positive values ----------
create table public.inspirational_values (
  id          smallint generated always as identity primary key,
  slug        text not null unique,
  label       text not null,
  description text,
  icon        text                       -- lucide icon name
);

create table public.movie_values (
  movie_id    bigint   not null references public.movies(id) on delete cascade,
  value_id    smallint not null references public.inspirational_values(id) on delete cascade,
  strength    smallint not null default 2 check (strength between 1 and 3), -- 3 = core theme
  primary key (movie_id, value_id)
);
create index movie_values_value_idx on public.movie_values (value_id, movie_id) include (strength);

-- ---------- Streaming ----------
create table public.streaming_providers (
  provider_id integer primary key,       -- TMDB provider id
  name        text not null,
  logo_path   text
);

create table public.streaming_cache (
  movie_id          bigint  not null references public.movies(id) on delete cascade,
  country_code      char(2) not null,
  provider_id       integer not null references public.streaming_providers(provider_id),
  monetization_type text    not null check (monetization_type in ('flatrate','free','ads','rent','buy')),
  deep_link         text,                -- TMDB regional JustWatch page; see README note on attribution
  fetched_at        timestamptz not null default now(),
  primary key (country_code, provider_id, movie_id, monetization_type)
);
-- PK leads with (country, provider) => exactly the access path for discovery.
create index streaming_cache_movie_idx on public.streaming_cache (movie_id, country_code);
create index streaming_cache_fresh_idx on public.streaming_cache (fetched_at);

-- ---------- updated_at trigger ----------
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger movies_touch before update on public.movies
  for each row execute function public.touch_updated_at();
create trigger cw_touch before update on public.content_warnings
  for each row execute function public.touch_updated_at();

-- ---------- Seed taxonomy ----------
insert into public.inspirational_values (slug, label, description, icon) values
  ('resilience',     'Resilience & Grit',        'Persisting through failure and hardship',        'mountain'),
  ('stem',           'Science & STEM',           'Curiosity about science, tech, engineering, math','flask-conical'),
  ('empathy',        'Emotional Empathy',        'Understanding and caring about others'' feelings','heart-handshake'),
  ('teamwork',       'Teamwork',                 'Achieving more together',                        'users'),
  ('problem_solving','Problem Solving',          'Creative and logical thinking',                  'puzzle'),
  ('environment',    'Environmental Stewardship','Caring for nature and the planet',               'leaf'),
  ('creativity',     'Creativity & Imagination', 'Making and imagining new things',                'palette'),
  ('honesty',        'Honesty & Integrity',      'Doing the right thing',                          'scale'),
  ('diversity',      'Cultures & Inclusion',     'Respect for different people and cultures',      'globe');

-- ---------- Row Level Security: public read of published data only ----------
alter table public.movies               enable row level security;
alter table public.content_warnings     enable row level security;
alter table public.inspirational_values enable row level security;
alter table public.movie_values         enable row level security;
alter table public.streaming_providers  enable row level security;
alter table public.streaming_cache      enable row level security;

create policy "public read published movies" on public.movies
  for select using (is_published);
create policy "public read warnings" on public.content_warnings
  for select using (exists (select 1 from public.movies m where m.id = movie_id and m.is_published));
create policy "public read values" on public.inspirational_values for select using (true);
create policy "public read movie_values" on public.movie_values
  for select using (exists (select 1 from public.movies m where m.id = movie_id and m.is_published));
create policy "public read providers" on public.streaming_providers for select using (true);
create policy "public read streaming" on public.streaming_cache
  for select using (exists (select 1 from public.movies m where m.id = movie_id and m.is_published));
-- Writes: only via service_role key (ingestion scripts), which bypasses RLS.
