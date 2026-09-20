# AGENTS.md

SF AI Pulse — automated daily ingestion of San Francisco AI/tech Instagram Reels.

## Architecture

- **Cloudflare Worker** (`worker/`) — runs daily at 9am UTC-5 via cron trigger.
- **R2 bucket** (`insider-data`) — stores `sf-ai-pins.json`, the accumulated dataset.
- **ScrapeCreators API** — fetches Instagram Reels matching "San Francisco AI" (last-week window, up to 11 pages).
- **OpenAI GPT-5.6-Luna** — editorial judge that approves/rejects candidates based on SF-tech relevance.

## Layout

- `worker/src/index.ts` — entry point, cron + HTTP handler, dedup logic.
- `worker/src/instagram.ts` — ScrapeCreators API client, SF geo-filtering.
- `worker/src/judge.ts` — OpenAI judge prompt and API call.
- `worker/src/types.ts` — shared TypeScript interfaces.
- `worker/wrangler.json` — Cloudflare Worker config (cron, R2 binding).
- `public/data/sf-ai-pins.json` — local copy of the dataset.
- `map.html` — search UI for browsing curated Reels.

## Commands

- `cd worker && npx wrangler deploy` — deploy the worker.
- `cd worker && npx wrangler tail` — stream live logs.
- `curl -X POST https://insider-ingest.juanmontreuil71.workers.dev/ingest` — manual trigger.
- `cd worker && npx wrangler r2 object get insider-data/sf-ai-pins.json --file=output.json --remote` — download dataset.
- `npm run check:types` — typecheck root project.

## Data flow

1. Cron fires daily → Worker reads existing `sf-ai-pins.json` from R2.
2. Fetches Reels from ScrapeCreators (query: "San Francisco AI", last-week).
3. Filters: missing fields, out-of-SF coordinates.
4. Dedup: skips all previously seen IDs (approved + rejected).
5. New candidates → OpenAI judge → approved IDs.
6. Merges approved Reels into `pins`, updates `seenReelIds`, writes back to R2.

## Secrets (Cloudflare)

- `SCRAPE_API_KEY` — ScrapeCreators API key.
- `OPENAI_API_KEY` — OpenAI API key.
