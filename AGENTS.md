# AGENTS.md

Insider — a San Francisco discovery site with TikTok video search and community place notes.

## Architecture

- **Primary Cloudflare Worker** (`worker/`) — ingests TikTok videos daily at 14:00 UTC (9:00 AM America/Lima), serves the signed-in site API, transcribes reel audio, and owns the user/assignment data.
- **Public MCP Cloudflare Worker** (`mcp/`) — `insider-mcp`, an OAuth-protected remote MCP server for Hermes. It has no direct D1 or R2 access; it reaches the primary Worker only through a Cloudflare service binding.
- **R2 bucket** (`insider-data`) — stores the legacy Instagram `sf-ai-pins.json`, the active TikTok `sf-ai-tiktok-videos.json`, place-note JSON objects, uploaded note images, cached reel media, and private transcripts.
- **Cloudflare Workers AI** — runs `@cf/openai/whisper-large-v3-turbo` during ingest to transcribe the TikTok audio.
- **Cloudflare OAuth Provider + MCP handler** — uses OAuth 2.1 with Dynamic Client Registration and PKCE. Cloudflare Access is the upstream identity provider; OAuth grants are stored in `OAUTH_KV`.
- **ScrapeCreators API** — fetches TikTok videos matching "San Francisco AI" (this-month window).
- **tinyld** — deterministic language detection; filters out non-English/non-Spanish captions during ingestion.
- **Google Maps JavaScript API + Places API (New)** — 2D community map and place autocomplete in the note drawer. The map starts centered on San Francisco; place search and note locations are not geographically restricted.
- **Cloudflare D1** (`insider-users`) — stores signed-in users, their Hermes OAuth connection state, and their reel assignments.
- **Authenticated site assets** — the main Worker serves the home page and TikTok results page from `dist/site`, so browser API calls share the signed-in origin.

## Layout

- `worker/src/index.ts` — cron, TikTok video ingestion, Whisper transcription, `/mcp`, `/data`, `/config`, `/notes`, `/note-images`, and legacy `/places` endpoints.
- `mcp/src/index.ts` — public OAuth endpoints, consent/callback UI, and the three Hermes MCP tools.
- `worker/src/tiktok.ts` — ScrapeCreators TikTok keyword-search client.
- `worker/src/types.ts` — shared TypeScript interfaces.
- `worker/wrangler.json` — Cloudflare Worker config (cron, R2 binding).
- `public/data/sf-ai-pins.json` — legacy local Instagram dataset copy.
- `index.html` — home page, Google map, place search, and sliding note panel.
- `map.html` — results page for browsing curated Reels; accepts the home search query.
- `dev-server.mjs` — local static preview and local `/config` endpoint.
- `worker/migrations/0001_hermes_assignments.sql` — D1 schema for users and reel assignments. `mcp_tokens` is legacy and no longer used.
- `worker/migrations/0002_hermes_oauth_connections.sql` — current OAuth connection gate for Hermes assignments.

## Commands

- `cd worker && npx wrangler deploy` — deploy the worker.
- `cd mcp && npx wrangler deploy` — deploy the public OAuth MCP Worker.
- `cd worker && npx wrangler tail` — stream live logs.
- `curl -X POST -H 'X-Ingest-Secret: …' https://insider-ingest.juanmontreuil71.workers.dev/ingest` — manual trigger when `INGEST_SECRET` is configured.
- `https://insider-mcp.juanmontreuil71.workers.dev/mcp` — public OAuth-protected MCP endpoint; do not expose it through the primary Worker or protect it with the browser Access application.
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

## Hermes MCP and personal assignments (OAuth)

The current public endpoint is `https://insider-mcp.juanmontreuil71.workers.dev/mcp`. It is a standard Streamable HTTP MCP server using OAuth 2.1, Dynamic Client Registration, and PKCE. Hermes stores its own OAuth tokens locally; Insider never displays or stores a user bearer token.

Cloudflare Access has two separate roles:

- The **Insider** Access app authenticates a person before they use the web UI. The primary Worker validates `Cf-Access-Jwt-Assertion`.
- The **Insider Hermes MCP** SaaS OIDC app authenticates the same person during the Hermes OAuth browser flow. Its callback is the MCP Worker `/callback` route.

The MCP Worker exchanges the Access identity with the primary Worker through `MCP_INTERNAL_SECRET` and a service binding. The primary Worker upserts the user, records `hermes_connections`, and permits only that user's assignments. No MCP tool returns R2 credentials, object keys, a temporary MP4 URL, or cross-user data.

Available tools:

- `insider_get_my_new_reels` — returns the current user's assigned, unviewed reels and transcripts.
- `insider_get_reel` — returns a particular reel only when it is assigned to that user.
- `insider_mark_reels_viewed` — marks completed assignments as viewed.

Assignments are intentionally manual. In `map.html`, **Assign to Hermes** remains disabled until a real OAuth connection exists. It writes to `reel_assignments` immediately; Hermes sees it the next time the user asks for their new Insider reels. There is no Telegram push notification or background processing queue in this MVP.

### User setup and validated flow

1. User signs into Insider first, then clicks **Connect Hermes** in the Reel page.
2. On the Hermes host, they run this as one line:

```bash
hermes mcp add --url https://insider-mcp.juanmontreuil71.workers.dev/mcp --auth oauth --connect-timeout 315 insider_reels
```

3. Hermes opens an OAuth URL. The user logs into Cloudflare Access and approves Insider.
4. Desktop Hermes can normally receive the loopback redirect. On a headless/VPS Hermes host, the MCP callback page displays a one-time callback URL; paste that URL (or its `?code=...&state=...` portion) into the Hermes terminal that is waiting. This is the supported Hermes OAuth-over-SSH pattern.
5. Hermes discovers and enables all three tools. If its Telegram gateway was already running, run `hermes gateway restart` once.
6. In Insider, assign a reel. In Telegram, ask: `Resume mis nuevos reels de Insider.` Hermes fetches the pending assignments, analyzes them, and marks them viewed after completion.

This flow was validated end-to-end on 2026-09-26: two assigned reels were fetched by Hermes and their `viewed_at` values were written in D1.

### MCP troubleshooting

- `insider-reels` and `insider_reels` are different Hermes server names. The validated configuration uses `insider_reels`.
- If Hermes says `auth=None`, remove the old legacy configuration and re-add it with `--auth oauth`.
- Do not split the `hermes mcp add` command across terminal lines.
- The initial `mcp add` client timeout can be short; use `--connect-timeout 315` for browser authorization. Do not arbitrarily lengthen OAuth code lifetime.
- For a remote VPS, the browser's `127.0.0.1` redirect error is expected. Copy the callback from the Insider completion page into the still-waiting VPS terminal; no tunnel is required for the MVP.

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
- `GEOAPIFY_API_KEY` — retained for the legacy `/places` proxy; the current home page uses Google Maps and Places directly.
- `CORS_ORIGINS` — comma-separated browser origins allowed to call the Worker API.
- `INGEST_SECRET` — secret required by manual `POST /ingest`; scheduled ingestion does not use it.
- `CF_ACCESS_TEAM_DOMAIN` — Cloudflare Access team domain used to validate browser-session JWTs.
- `CF_ACCESS_AUD` — Cloudflare Access application audience used to validate browser-session JWTs.
- `MCP_URL` — optional public MCP URL shown in the user connection dialog. Use it when `/mcp` has a separate hostname.
- `MCP_INTERNAL_SECRET` — shared secret between the primary Worker and MCP Worker for its service-binding-only internal routes; set the same value on both Workers.
- `ACCESS_CLIENT_SECRET` — secret for the Cloudflare Access SaaS OIDC application; set only on the MCP Worker.
- `OAUTH_KV` — KV namespace binding on the MCP Worker for OAuth grants, clients, and authorization state (not a plaintext user-token store).
