# Akira: Owner Guide (host, configure, maintain)

Free, mobile-first PWA that finds family movies by content boundaries + positive values + what's streaming in your region.
Stack: Next.js (static export) · Tailwind · shadcn-style UI · Supabase Postgres · TMDB · Cloudflare Pages (free).

## 1. How it fits the Cloudflare free plan
The site is a **static export** (`out/`), served by Cloudflare Pages: free, unlimited bandwidth, no Worker CPU limits.
The browser calls Supabase directly (one `discover_movies` RPC per search) with the public anon key. Ingestion and
LLM tagging run on your machine or GitHub Actions, never on Cloudflare.

## 2. Run locally
```bash
npm install
cp .env.example .env          # fill in later; blank frontend vars = demo mode with 5 sample films
npm run dev                   # http://localhost:3000
```

## 3. Set up Supabase (free)
1. Create a project at supabase.com. Settings → API: copy **Project URL**, **anon key**, **service_role key**.
2. SQL Editor: run `supabase/migrations/0001_schema.sql`, then `0002_discover_fn.sql`.
3. Fill `.env`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Load sample data: `npm run seed` (5 films with exact severities/values/streaming). Reload the app.
> The **service_role key is secret**: only in `.env` / GitHub secrets, never in `NEXT_PUBLIC_*`.
> RLS already limits the public to reading *published* rows.

## 4. Get real data (TMDB)
1. Create a free account at themoviedb.org → Settings → API → copy the **API Read Access Token** to `TMDB_READ_TOKEN`.
2. Pull family movies streaming in a country: `npm run ingest -- --country IN --providers 8,119,122 --pages 3`
   (provider ids: 8 Netflix, 119 Prime Video, 122 Disney+ Hotstar, 337 Disney+, 1899 Max, 350 Apple TV+).
3. Tag content: get a free Gemini API key at aistudio.google.com and set `LLM_API_KEY` (endpoint/model defaults in `.env.example` already point at Gemini; the script waits `LLM_DELAY_MS`=7000 ms between calls for the free-tier rate limit), optionally put parents-guide text in
   `data/parents-guides/<tmdb_id>.txt` (from sources you're permitted to use; **don't scrape IMDb/Common Sense**), then
   `npm run tag -- --limit 20`. Movies stay **unpublished** until reviewed: in Supabase Table Editor set `is_published = true`
   and `review_status = 'human_verified'` (or use `--publish`, which only publishes with a guide file and confidence ≥ 0.8).
4. Always spot-check LLM severities for the youngest age groups before publishing; parents rely on them.

## 5. Deploy to Cloudflare Pages
1. Push the repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git → select repo.
3. Build command `npm run build`, output directory `out`, env var `NODE_VERSION=20`.
4. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and (optional) `NEXT_PUBLIC_REPORT_URL` (e.g. `https://github.com/<you>/akira/issues/new`, shows a "Report a wrong rating" link) under Settings → Environment variables (they're baked in at build time, so redeploy after changing).
5. Optional: add a custom domain under Custom domains. Every push to `main` redeploys automatically.
CLI alternative: `npm run build && npx wrangler pages deploy out --project-name akira`.

## 6. Maintain
| Task | How often | Command / place |
|---|---|---|
| Refresh streaming availability | Weekly | `.github/workflows/sync.yml` (add repo secrets `TMDB_READ_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) or `npm run ingest -- --country IN --refresh-stale` |
| Add new movies | As desired | `ingest` then `tag`, review, publish |
| Add a country | Anytime | add to `COUNTRIES` in `lib/constants.ts`, run `ingest --country XX` |
| Add a streaming service | Anytime | add to `PROVIDERS` in `lib/constants.ts` (use TMDB provider id) |
| Add a value tag | Rare | insert into `inspirational_values`, add to `VALUES` in `lib/constants.ts`, add the slug to the prompt + zod enum in `scripts/tag-movies.ts` |
| Keep Supabase awake | Automatic | the weekly workflow; free projects pause after ~1 week idle |
| Verify query speed | After large imports | `explain analyze` in `supabase/queries.sql` |
| Switch LLM | Anytime | change `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` in `.env`. To re-tag with the new model: `update movies set review_status='draft' where id in (select movie_id from content_warnings where tagged_by = 'old-model-name' and source='llm');` then `npm run tag` |
| Fix a wrong rating | When reported | edit `content_warnings` row, set `source='curated'` |

## 7. Limits and compliance
- Supabase free: 500 MB DB (tens of thousands of films fit easily). TMDB: personal/non-commercial free use; keep the attribution text in the footer.
- Streaming data is by JustWatch via TMDB; keep attribution. Deep links go to TMDB's regional watch page.
- When a film isn't available on the user's services the app suggests only legal options (other services, rent/buy, library apps). Don't add piracy links.
- Poster paths in `data/seed.json` were hand-entered; if one 404s the card falls back to a title tile. Re-run `ingest` for correct paths.
- The seed severities/availability are demo values, not authoritative.

## 8. Defaults and licence
First-time visitors get their country from the browser locale (supported: see `COUNTRIES`), falling back to India with Netflix, Prime Video and Disney+ Hotstar. Site URL starts as `akira.pages.dev` (project name `akira`; add a custom domain later). Licensed AGPL-3.0 (`LICENSE`): anyone running a modified public copy must publish their changes.

## 9. Project map
`app/` page · `components/` UI · `lib/` filters, presets, discovery · `supabase/` SQL · `scripts/` ingest/tag/seed · `prompts/` LLM prompt · `data/seed.json`
