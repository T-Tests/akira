-- Run only against a disposable migrated Supabase database as a privileged user.
-- All fixtures are rolled back; never run integration tests against production.
begin;

insert into public.movies (tmdb_id, title, audience, is_published)
values (2147483000, 'Community review fixture', 'kids', true),
       (2147483001, 'Adult tag fixture', 'adults', false);
insert into public.content_warnings (movie_id)
select id from public.movies where tmdb_id = 2147483000;
insert into public.streaming_providers (provider_id, name) values (2147483000, 'Fixture');
insert into public.streaming_cache (movie_id, country_code, provider_id, monetization_type)
select id, 'US', 2147483000, 'flatrate' from public.movies where tmdb_id = 2147483000;
insert into auth.users (id, email_confirmed_at)
select ('00000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
  case when i = 9 then null else now() end from generate_series(1, 9) i;

do $$
declare
  movie bigint := (select id from public.movies where tmdb_id = 2147483000);
  state text;
  results integer;
  adult bigint := (select id from public.movies where tmdb_id = 2147483001);
  tag jsonb := '{"tmdb_id":2147483001,"violence":0,"scariness":0,"language":0,"sexual_content":0,"mature_themes":0,"lgbtq_themes":0,"values":[],"takeaway":"Test takeaway","advisory":"Test advisory","recommended_min_age":13,"confidence":0.9}';
begin
  if has_function_privilege('anon', 'public.review_movie(int, text)', 'execute')
    or has_function_privilege('authenticated', 'public.review_movie(int, text)', 'execute') then
    raise exception 'legacy review may bypass community voting';
  end if;
  if has_function_privilege('anon', 'public.vote_kids_movie(bigint, boolean)', 'execute') then
    raise exception 'anonymous users may vote';
  end if;
  if has_table_privilege('authenticated', 'public.kids_votes', 'insert') then
    raise exception 'authenticated users may bypass vote RPC';
  end if;
  if has_function_privilege('authenticated', 'public.complete_movie_tagging(bigint,jsonb,text)', 'execute')
    or has_function_privilege('anon', 'public.replace_movie_availability(bigint,jsonb)', 'execute') then
    raise exception 'public clients may write catalogue data';
  end if;
  perform public.complete_movie_tagging(adult, tag, 'fixture');
  if not exists (select 1 from public.movies m join public.content_warnings cw on cw.movie_id = m.id
    where m.id = adult and m.is_published and cw.confidence is null) then
    raise exception 'adult tagging must publish without confidence';
  end if;
  update public.movies set is_published = false, review_status = 'rejected' where id = adult;
  begin
    perform public.complete_movie_tagging(adult, tag, 'fixture');
    raise exception 'withdrawn film was republished';
  exception when raise_exception then
    if sqlerrm <> 'Movie state changed during tagging' then raise; end if;
  end;
  select count(*) into results from public.discover_movies(null, array[2147483000], 'kids');
  if results <> 0 then raise exception 'pending Kids film is visible'; end if;
  select count(*) into results from public.discover_movies(null, array[2147483000], 'adults')
    where value_slugs = '{}'::text[] and providers->0->>'country' = 'US';
  if results <> 1 then raise exception 'adult result, values, or country is wrong'; end if;
  select count(*) into results from public.search_movies_for_audience('Community review fixture', 'kids');
  if results <> 0 then raise exception 'pending Kids film appears in Kids search'; end if;
  select count(*) into results from public.search_movies_for_audience('Community review fixture', 'adults')
    where providers->0->>'country' = 'US';
  if results <> 1 then raise exception 'adult search does not show country-labeled offer'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000009', true);
  begin
    perform public.vote_kids_movie(movie, true);
    raise exception 'unverified user was allowed to vote';
  exception when raise_exception then
    if sqlerrm <> 'A verified email account is required' then raise; end if;
  end;
  for i in 1..5 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(i::text, 12, '0'), true);
    perform public.vote_kids_movie(movie, true);
  end loop;
  select kids_status into state from public.movies where id = movie;
  if state <> 'approved' then raise exception 'five approvals must approve'; end if;
  for i in 1..5 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(i::text, 12, '0'), true);
    perform public.vote_kids_movie(movie, false);
  end loop;
  select kids_status into state from public.movies where id = movie;
  if state <> 'rejected' then raise exception 'rejection majority must reject'; end if;
  update public.kids_review_settings set approval_threshold = 2;
  for i in 1..3 loop
    perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-' || lpad(i::text, 12, '0'), true);
    perform public.vote_kids_movie(movie, true);
  end loop;
  select kids_status into state from public.movies where id = movie;
  if state <> 'approved' then raise exception 'later approvals must be counted'; end if;
  delete from auth.users where id = '00000000-0000-0000-0000-000000000003';
  select kids_status into state from public.movies where id = movie;
  if state <> 'pending' then raise exception 'deleting a voter must recalculate status'; end if;
end $$;
rollback;
