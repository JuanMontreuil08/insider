# AGENTS.md

Insider — a San Francisco discovery site with TikTok video search and community place notes.

## Architecture

- **Cloudflare Worker** (`worker/`) — ingests TikTok videos daily at 14:00 UTC (9:00 AM America/Lima), serves the site API, transcribes reel audio, and exposes the private Hermes MCP endpoint.
- **R2 bucket** (`insider-data`) — stores the legacy Instagram `sf-ai-pins.json`, the active TikTok `sf-ai-tiktok-videos.json`, place-note JSON objects, uploaded note images, cached reel media, and private transcripts.
- **Cloudflare Workers AI** — runs `@cf/openai/whisper-large-v3-turbo` during ingest to transcribe the TikTok audio.
- **Cloudflare Agents MCP handler** — serves a stateless, bearer-protected remote MCP endpoint so a user's Hermes agent can retrieve reel context without R2 credentials.
- **ScrapeCreators API** — fetches TikTok videos matching "San Francisco AI" (this-month window).
- **tinyld** — deterministic language detection; filters out non-English/non-Spanish captions during ingestion.
- **Google Maps JavaScript API + Places API (New)** — 2D community map and place autocomplete in the note drawer. The map starts centered on San Francisco; place search and note locations are not geographically restricted.
- **Cloudflare D1** (`insider-users`) — stores Cloudflare Access users, one active personal MCP token per user, and their reel assignments.
- **Authenticated site assets** — the main Worker serves the home page and TikTok results page from `dist/site`, so browser API calls share the signed-in origin.

## Layout

- `worker/src/index.ts` — cron, TikTok video ingestion, Whisper transcription, `/mcp`, `/data`, `/config`, `/notes`, `/note-images`, and legacy `/places` endpoints.
- `worker/src/tiktok.ts` — ScrapeCreators TikTok keyword-search client.
- `worker/src/types.ts` — shared TypeScript interfaces.
- `worker/wrangler.json` — Cloudflare Worker config (cron, R2 binding).
- `public/data/sf-ai-pins.json` — legacy local Instagram dataset copy.
- `index.html` — home page, Google map, place search, and sliding note panel.
- `map.html` — results page for browsing curated Reels; accepts the home search query.
- `dev-server.mjs` — local static preview and local `/config` endpoint.
- `worker/migrations/0001_hermes_assignments.sql` — D1 schema for users, MCP tokens, and reel assignments.

## Commands

- `cd worker && npx wrangler deploy` — deploy the worker.
- `cd worker && npx wrangler tail` — stream live logs.
- `curl -X POST https://insider-ingest.juanmontreuil71.workers.dev/ingest` — manual trigger.
- `curl -X POST https://insider-ingest.juanmontreuil71.workers.dev/mcp ...` — MCP protocol endpoint; it requires a personal bearer token created by the signed-in user and a valid JSON-RPC body.
- `cd worker && npx wrangler r2 object get insider-data/sf-ai-tiktok-videos.json --file=output.json --remote` — download the active TikTok dataset.
- `npm run check:types` — typecheck root project.
- `npm run dev:site` — local preview at `http://127.0.0.1:4173/`; Node loads the root `.env` at runtime. Do not print or inspect the key.
- `npm run build:site` — copy both pages into `dist/site` before deploying the static site.
- `cd worker && npx wrangler d1 migrations apply insider-users --remote` — apply D1 schema changes.
- `npm run build:site && cd worker && npx wrangler deploy` — build and deploy the site plus API from one Worker.

## Data flow

1. Cron fires daily → Worker reads existing `sf-ai-tiktok-videos.json` from R2.
2. Fetches TikTok videos from ScrapeCreators (query: "San Francisco AI", this-month).
3. Filters malformed records and non-English/non-Spanish captions (tinyld).
4. Dedup: skips all previously seen IDs.
5. Caches new thumbnails in R2 (avoids TikTok CDN hotlink issues) and caches the MP4 under `reels-temp/<reelId>.mp4`.
6. Downloads the source audio and sends it to Workers AI Whisper. The private result is stored at `reel-transcripts/<reelId>.json`; the public catalog keeps only status, language, and word count.
7. Appends new videos to `pins`, updates `seenReelIds`, writes back to `sf-ai-tiktok-videos.json`.

## Reel media and transcripts

- `thumbs/<reelId>` is the durable, public thumbnail path served by the Worker.
- `reels-temp/<reelId>.mp4` is an ingest cache only. It has an R2 lifecycle expiry of one day and is not exposed by the site or MCP.
- `reel-transcripts/<reelId>.json` is private. It contains the Whisper text, detected language, timestamped segments, VTT, model name, and generation time.
- Transcript states are `ready`, `no_speech`, `unavailable`, and `failed`. Treat `text` and timestamped `segments` as the quality signal. Do not use `wordCount` to decide quality, especially for non-English languages.
- A missing/failed transcript never blocks a reel from appearing in the catalog: transcription is best-effort.

## Hermes MCP and personal assignments

`POST https://insider-ingest.juanmontreuil71.workers.dev/mcp` is a standard stateless Streamable HTTP MCP endpoint. It uses the Cloudflare Agents `createMcpHandler`; it is not an SSE-only custom server.

Users create a personal MCP token once from the signed-in Reel page. `insider_get_my_new_reels` returns their assigned reels and private transcripts; `insider_mark_reels_viewed` clears completed work. `insider_get_reel` requires that the reel is assigned to the requesting user. No tool returns R2 credentials, private object keys, or a direct temporary MP4 URL.

The site is behind Cloudflare Access. The Worker verifies `Cf-Access-Jwt-Assertion` against the configured Access team JWKS, audience, issuer, expiry, and not-before claims before it creates or reads user assignments. Configure `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` as Worker environment values and protect browser routes at the Cloudflare edge. The `/mcp` route must remain reachable with its personal bearer token.

Each signed-in user can assign reels in the UI. D1 writes the assignment before the UI confirms success, so the user may immediately ask Hermes to inspect their new reels. D1 is deliberately queried from its primary for this read-after-write path.

### User connection

1. The user signs in before entering Insider.
2. In the Reel page they select **Connect Hermes** and copy the generated configuration. The raw token appears only in that response and D1 stores only its SHA-256 hash.
3. Creating a new connection token revokes the user's earlier token. Never expose it to browsers after the initial connection dialog, R2, or Git.

The expected test result is `Connected` and tools discovered include `insider_get_my_new_reels`. A successful end-to-end prompt is:

```text
Resume mis reels nuevos de Insider en español en 4 viñetas cada uno e indica idioma y si detectaste voz.
```

### MCP troubleshooting

- Hermes MCP `HTTP 400` can originate at the Cloudflare edge before the Worker. Verify the personal token and that the Access policy bypasses `/mcp` before changing MCP code.
- A token replacement deliberately revokes the older Hermes configuration. Generate a new configuration block if an existing connection returns `401`.
- A direct authenticated JSON-RPC `initialize`/`tools/call` request from the development machine returned HTTP 200 during the original single-user prototype validation.

## Community notes

1. The browser loads Google Maps with the browser key from `/config` and starts the map at San Francisco.
2. Google Places provides suggestions directly in the browser. Selecting one supplies its name, Place ID, and coordinates.
3. A user submits a note and optional photo to `POST /notes`; the Worker stores JSON and images in R2.
4. `GET /notes` returns notes; the home page renders red markers. Clicking a marker opens its note in the right-hand panel.
5. Local preview gets the key from the root `.env` through `dev-server.mjs`. The deployed site needs `GOOGLE_MAPS_API_KEY` configured on `insider-ingest` in Cloudflare. Browser keys must be restricted to the preview and production site origins in Google Cloud.

TikTok discovery is not geographically filtered; language detection keeps only English and Spanish captions. Community place notes are likewise not geographically restricted.

## Secrets (Cloudflare)

- `SCRAPE_API_KEY` — ScrapeCreators API key.
- `GOOGLE_MAPS_API_KEY` — browser key for Maps JavaScript API and Places API (New). Currently available in the local environment; configure it on the deployed Worker before publishing the new home page.
- `MAPBOX_PUBLIC_TOKEN` and `GEOAPIFY_API_KEY` — retained for compatibility with the currently deployed older static site until the Google Maps site is deployed.
- `CF_ACCESS_TEAM_DOMAIN` — Cloudflare Access team domain used to validate browser-session JWTs.
- `CF_ACCESS_AUD` — Cloudflare Access application audience used to validate browser-session JWTs.
- `MCP_URL` — optional public MCP URL shown in the user connection dialog. Use it when `/mcp` has a separate hostname.
