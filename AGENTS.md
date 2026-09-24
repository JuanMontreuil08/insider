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
- **Static site Worker** (`wrangler.site.json`) — serves the home page and TikTok results page.

## Layout

- `worker/src/index.ts` — cron, TikTok video ingestion, Whisper transcription, `/mcp`, `/data`, `/config`, `/notes`, `/note-images`, and legacy `/places` endpoints.
- `worker/src/tiktok.ts` — ScrapeCreators TikTok keyword-search client.
- `worker/src/types.ts` — shared TypeScript interfaces.
- `worker/wrangler.json` — Cloudflare Worker config (cron, R2 binding).
- `public/data/sf-ai-pins.json` — legacy local Instagram dataset copy.
- `index.html` — home page, Google map, place search, and sliding note panel.
- `map.html` — results page for browsing curated Reels; accepts the home search query.
- `dev-server.mjs` — local static preview and local `/config` endpoint.
- `wrangler.site.json` — static site deployment config.

## Commands

- `cd worker && npx wrangler deploy` — deploy the worker.
- `cd worker && npx wrangler tail` — stream live logs.
- `curl -X POST https://insider-ingest.juanmontreuil71.workers.dev/ingest` — manual trigger.
- `curl -X POST https://insider-ingest.juanmontreuil71.workers.dev/mcp ...` — MCP protocol endpoint; it requires `Authorization: Bearer <HERMES_MCP_TOKEN>` and a valid JSON-RPC body.
- `cd worker && npx wrangler r2 object get insider-data/sf-ai-tiktok-videos.json --file=output.json --remote` — download the active TikTok dataset.
- `npm run check:types` — typecheck root project.
- `npm run dev:site` — local preview at `http://127.0.0.1:4173/`; Node loads the root `.env` at runtime. Do not print or inspect the key.
- `npm run build:site` — copy both pages into `dist/site` before deploying the static site.
- `worker/node_modules/.bin/wrangler deploy --config wrangler.site.json` — deploy the static site from the repository root after building it.

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

## Hermes MCP (validated single-user prototype)

`POST https://insider-ingest.juanmontreuil71.workers.dev/mcp` is a standard stateless Streamable HTTP MCP endpoint. It uses the Cloudflare Agents `createMcpHandler`; it is not an SSE-only custom server.

The only tool is `insider_get_reel` with a numeric TikTok `reelId`. It returns the catalog metadata, original TikTok URL, durable thumbnail URL, and the private Whisper transcript with segments. It never returns R2 credentials, private object keys, or a direct temporary MP4 URL.

### Cloudflare setup

1. Set the Worker secret without committing or printing it:

   ```bash
   cd worker && npx wrangler secret put HERMES_MCP_TOKEN
   ```

2. Deploy the Worker:

   ```bash
   cd worker && npx wrangler deploy
   ```

### Hermes VPS setup and validation

On the Hermes host, save the same token in `~/.hermes/.env` with permissions `600`; do not put the token in `config.yaml` or commit it.

```yaml
mcp_servers:
  insider_reels:
    url: "https://insider-ingest.juanmontreuil71.workers.dev/mcp"
    headers:
      Authorization: "Bearer ${INSIDER_HERMES_MCP_TOKEN}"
    enabled: true
    timeout: 120
    connect_timeout: 60
    skip_preflight: true
```

Commands used for the successful validation:

```bash
chmod 700 ~/.hermes
chmod 600 ~/.hermes/.env
hermes mcp test insider_reels
hermes chat
```

The expected test result is `Connected` and `Tools discovered: 1`, showing `insider_get_reel`. A successful end-to-end prompt is:

```text
Usa insider_get_reel para revisar el reel 7688494746121080094.
Resume su contenido en español en 4 viñetas e indica idioma y si detectaste voz.
```

### MCP troubleshooting learned during validation

- Hermes MCP `HTTP 400` can originate at the Cloudflare edge before the Worker. First verify the exact token, not the MCP implementation.
- Safely compare token copies by hashing the original local token file and the value stored in `~/.hermes/.env`; the hashes must match. Never paste the token into a terminal transcript.
- The confirmed incident was a mismatched VPS token. After securely replacing it with the same token held by the Worker secret, `hermes mcp test insider_reels` connected in about 1.2 seconds and discovered the tool.
- A direct authenticated JSON-RPC `initialize`/`tools/call` request from the development machine also returned HTTP 200, confirming the endpoint is compatible with current Hermes.

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
- `HERMES_MCP_TOKEN` — bearer token for the temporary single-user Hermes MCP prototype. It must be a Cloudflare Worker secret and a value in the individual Hermes host's `~/.hermes/.env`; never expose it to browsers, R2, or Git.
