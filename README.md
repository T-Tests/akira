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
cp .env.example .env          # fill in later; blank frontend vars = demo mode with 10 sample films
npm run dev                   # http://localhost:3000
```

## 3. Set up Supabase (free)
1. Create a project at supabase.com. Settings → API: copy **Project URL**, **anon key**, **service_role key**.
2. SQL Editor: run, in order, `supabase/migrations/0001_schema.sql`, `0002_discover_fn.sql`, `0003_world_cinema.sql` (adds the Kids/Adults audience, languages, countries, black-and-white flag, adult themes and the final `discover_movies`), `0004_auto_review.sql` (allows the `auto_approved` status).
3. Fill `.env`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
4. Load sample data: `npm run seed` (10 demo films, including adult/world cinema). Reload the app.
> The **service_role key is secret**: only in `.env` / GitHub secrets, never in `NEXT_PUBLIC_*`.
> RLS already limits the public to reading *published* rows.

## 4. Get real data (TMDB)
1. Create a free account at themoviedb.org → Settings → API → copy the **API Read Access Token** to `TMDB_READ_TOKEN`.
2. Pull family movies streaming in a country: `npm run ingest -- --country IN --providers 8,119,122 --pages 3`
   (provider ids: 8 Netflix, 119 Prime Video, 122 Disney+ Hotstar, 337 Disney+, 1899 Max, 350 Apple TV+).
   World cinema / adults examples (provider ids: 11 MUBI, 258 Criterion Channel, 191 Kanopy; **verify them** via TMDB `GET /watch/providers/movie`):
   ```bash
   npm run ingest -- --country US --audience adults --bw --year-max 1969 --providers 258,11,1899,8   # black & white classics
   npm run ingest -- --country IN --audience adults --language ja --pages 3                           # Japanese cinema
   npm run ingest -- --country IN --audience adults --language bn --providers 8,119,122                # Bengali cinema
   ```
   Adults discovery excludes the Family genre and sorts by rating (min 300 votes; `--min-votes` to change). A film ingested for both audiences
   becomes `audience = 'both'`. Black & white comes from TMDB's "black and white" keyword (not perfect; fix individual rows with `is_black_and_white`).
   **Subtitles:** TMDB has no subtitle/dub data, so cards say "subtitles vary by app" unless you fill `subtitle_languages` / `audio_languages` yourself.
3. Tag content: get a free Gemini API key at aistudio.google.com and set `LLM_API_KEY` (endpoint/model defaults in `.env.example` already point at Gemini; the script waits `LLM_DELAY_MS`=7000 ms between calls for the free-tier rate limit), optionally put parents-guide text in
   `data/parents-guides/<tmdb_id>.txt` (from sources you're permitted to use; **don't scrape IMDb/Common Sense**), then
   `npm run tag -- --limit 20 --auto`. **Automated AI review:** every film gets two independent LLM passes (the second is a
   strict, safety-first reviewer). The film is auto-published (`review_status = 'auto_approved'`) only if the passes agree
   (kids: identical severities; adults: within 1), confidence is high (kids ≥ 0.85, adults ≥ 0.75) and suggested ages are
   within 2 years. The **higher** severity of the two is always stored. Anything else stays unpublished for you
   (`npm run review -- --list`, then `--approve <tmdb_ids>` or `--reject <tmdb_ids>`).
4. Spot-check occasionally: `npm run review -- --audit 20` prints a random sample of auto-published films. Pull a wrong one with `npm run review -- --unpublish <tmdb_id>` (e.g. after a "Report a wrong rating" issue).

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
| Refresh all supported regions | Weekly (automatic, Monday 03:00 UTC) | `.github/workflows/sync.yml` covers IN/US/GB/CA/AU/AE. Per region it discovers Kids (3 pages), Adults (3 pages), 20 original-language lanes (1 page each), and black-and-white Adults (2 pages); then refreshes availability for every known title in that country. It tags up to 50 new drafts afterward. Add repo secrets `TMDB_READ_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LLM_API_KEY`. |
| Add / tag new movies | Weekly + manual | The workflow discovers new titles; tagging + AI review is runs **daily** at 100 drafts per run (2 LLM calls each, about 200 requests, within Gemini's free daily quota; lower `--limit` if you hit 429s). Ingestion stays weekly; the backlog drains within days. Agreed, high-confidence films publish automatically; the rest wait for `npm run review -- --list`. Trigger with Actions → Weekly catalogue sync → Run workflow. |
| Add a region | Before enabling it | Add its country to `COUNTRIES` in `lib/constants.ts` and provider IDs to the matrix in `.github/workflows/sync.yml`; confirm providers through TMDB's regional watch-provider list. The scheduled job only covers countries in both places. |
| Add a language chip or era | Anytime | `LANGUAGES` / `ERAS` in `lib/constants.ts` (ISO 639-1 codes) |
| Add a country | Anytime | add to `COUNTRIES` in `lib/constants.ts`, run `ingest --country XX` |
| Add a streaming service | Anytime | add to `PROVIDERS` in `lib/constants.ts` (use TMDB provider id) |
| Add a value/theme tag | Rare | insert into `inspirational_values` (set `audience` to kids/adults/both), add to `KIDS_VALUES` or `ADULT_VALUES` in `lib/constants.ts`, add the slug to the prompt + zod enum in `scripts/tag-movies.ts` |
| Keep Supabase awake | Automatic | the weekly workflow; free projects pause after ~1 week idle |
| Verify query speed | After large imports | `explain analyze` in `supabase/queries.sql` |
| Auditor model | Optional | `LLM_AUDIT_*` (and the `LLM_AUDIT_API_KEY` Actions secret) pick the second-pass model, default `gpt-oss:20b-cloud` on Ollama Cloud. Swap the model id to try others (e.g. a different `*-cloud` model). Leave the key empty to reuse the primary model. Ollama's free cloud tier has usage limits; lower `--limit` if you hit them. |
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
