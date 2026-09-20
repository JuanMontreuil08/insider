# Insider

Insider has two pages: `index.html` is the search and city map home page; `map.html` shows searchable Instagram Reels. A search on the home page opens `/map.html?q=...`.

The Cloudflare Worker serves the Reel catalog at `/data`, Google Maps configuration at `/config`, and community place notes at `/notes`. Notes and uploaded photos are stored as separate R2 objects so new posts do not overwrite one another. The home page loads current notes and adds a newly published note immediately.

## Setup

1. Set `SCRAPE_API_KEY` and `OPENAI_API_KEY` as Worker secrets for ingestion.
2. Enable Maps JavaScript API and Places API (New) in Google Cloud. Create a browser API key restricted to the local and production site origins, then set it as `GOOGLE_MAPS_API_KEY` on the Worker. The home page uses a 2D Google map and Google's place autocomplete.
3. Deploy the API with `cd worker && npx wrangler deploy`.
4. Run `npm run build:site`, then `worker/node_modules/.bin/wrangler deploy --config wrangler.site.json` from the repository root. The site is published at `https://insider-sf.juanmontreuil71.workers.dev`.

The map opens centered on San Francisco. Search and pins can use any location. Notes require a place and description; JPG, PNG, or WebP photos under 5 MB are optional. A public deployment should add abuse controls and moderation before promoting uploads widely.

## Development

`npm run dev:site` starts the local site at `http://127.0.0.1:4173/` and loads `GOOGLE_MAPS_API_KEY` from the root `.env` at runtime. Do not commit or print the key. `npm run check:types` checks the Worker TypeScript. The Worker cron ingests recent Reels into `sf-ai-pins.json` in the `insider-data` R2 bucket. `/ingest` can trigger ingestion manually.
