-- Keep the browser API read-only; the ingestion scripts use the secret key.
revoke all on table
  public.movies,
  public.content_warnings,
  public.inspirational_values,
  public.movie_values,
  public.streaming_providers,
  public.streaming_cache
from anon, authenticated;

grant select on table
  public.movies,
  public.content_warnings,
  public.inspirational_values,
  public.movie_values,
  public.streaming_providers,
  public.streaming_cache
to anon, authenticated;

revoke execute on function public.discover_movies(
  bpchar, integer[], text,
  smallint, smallint, smallint, smallint, smallint, smallint,
  text[], text, smallint, text[], text[], smallint, smallint, boolean,
  text[], integer, integer
) from public;

grant execute on function public.discover_movies(
  bpchar, integer[], text,
  smallint, smallint, smallint, smallint, smallint, smallint,
  text[], text, smallint, text[], text[], smallint, smallint, boolean,
  text[], integer, integer
) to anon, authenticated;
