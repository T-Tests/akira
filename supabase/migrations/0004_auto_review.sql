-- AI-reviewed films: published automatically when two independent LLM passes agree.
alter table public.movies drop constraint if exists movies_review_status_check;
alter table public.movies add constraint movies_review_status_check
  check (review_status in ('draft','llm_tagged','auto_approved','human_verified','rejected'));
