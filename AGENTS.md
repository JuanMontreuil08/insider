# AGENTS.md

Insider — a San Francisco discovery site with Reel search and community place notes.

## Architecture

- **Cloudflare Worker** (`worker/`) — ingests Reels daily at 14:00 UTC and serves the site API.
- **R2 bucket** (`insider-data`) — stores `sf-ai-pins.json`, place-note JSON objects, and uploaded note images.
- **ScrapeCreators API** — fetches Instagram Reels matching "San Francisco AI" (last-week window, up to 11 pages).
- **OpenAI GPT-5.6-Luna** — editorial judge that approves/rejects candidates based on SF-tech relevance.
- **Google Maps JavaScript API + Places API (New)** — 2D community map and place autocomplete in the note drawer. The map starts centered on San Francisco; place search and note locations are not geographically restricted.
- **Static site Worker** (`wrangler.site.json`) — serves the home page and Reel results page.

## Layout

- `worker/src/index.ts` — cron, Reel ingestion, `/data`, `/config`, `/notes`, `/note-images`, and legacy `/places` endpoints.
- `worker/src/instagram.ts` — ScrapeCreators API client, SF geo-filtering.
- `worker/src/judge.ts` — OpenAI judge prompt and API call.
- `worker/src/types.ts` — shared TypeScript interfaces.
- `worker/wrangler.json` — Cloudflare Worker config (cron, R2 binding).
- `public/data/sf-ai-pins.json` — local copy of the dataset.
- `index.html` — home page, Google map, place search, and sliding note panel.
- `map.html` — results page for browsing curated Reels; accepts the home search query.
- `dev-server.mjs` — local static preview and local `/config` endpoint.
- `wrangler.site.json` — static site deployment config.

## Commands

- `cd worker && npx wrangler deploy` — deploy the worker.
- `cd worker && npx wrangler tail` — stream live logs.
- `curl -X POST https://insider-ingest.juanmontreuil71.workers.dev/ingest` — manual trigger.
- `cd worker && npx wrangler r2 object get insider-data/sf-ai-pins.json --file=output.json --remote` — download dataset.
- `npm run check:types` — typecheck root project.
- `npm run dev:site` — local preview at `http://127.0.0.1:4173/`; Node loads the root `.env` at runtime. Do not print or inspect the key.
- `npm run build:site` — copy both pages into `dist/site` before deploying the static site.
- `worker/node_modules/.bin/wrangler deploy --config wrangler.site.json` — deploy the static site from the repository root after building it.

## Data flow

1. Cron fires daily → Worker reads existing `sf-ai-pins.json` from R2.
2. Fetches Reels from ScrapeCreators (query: "San Francisco AI", last-week).
3. Filters: missing fields, out-of-SF coordinates.
4. Dedup: skips all previously seen IDs (approved + rejected).
5. New candidates → OpenAI judge → approved IDs.
6. Merges approved Reels into `pins`, updates `seenReelIds`, writes back to R2.

## Community notes

1. The browser loads Google Maps with the browser key from `/config` and starts the map at San Francisco.
2. Google Places provides suggestions directly in the browser. Selecting one supplies its name, Place ID, and coordinates.
3. A user submits a note and optional photo to `POST /notes`; the Worker stores JSON and images in R2.
4. `GET /notes` returns notes; the home page renders red markers. Clicking a marker opens its note in the right-hand panel.
5. Local preview gets the key from the root `.env` through `dev-server.mjs`. The deployed site needs `GOOGLE_MAPS_API_KEY` configured on `insider-ingest` in Cloudflare. Browser keys must be restricted to the preview and production site origins in Google Cloud.

The ingestion geo-filter in `worker/src/instagram.ts` still applies to Reels. It does not limit community place notes.

## Secrets (Cloudflare)

- `SCRAPE_API_KEY` — ScrapeCreators API key.
- `OPENAI_API_KEY` — OpenAI API key.
- `GOOGLE_MAPS_API_KEY` — browser key for Maps JavaScript API and Places API (New). Currently available in the local environment; configure it on the deployed Worker before publishing the new home page.
- `MAPBOX_PUBLIC_TOKEN` and `GEOAPIFY_API_KEY` — retained for compatibility with the currently deployed older static site until the Google Maps site is deployed.
