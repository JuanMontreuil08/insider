# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/subagents/` — the two isolated Flue stage agents: curator then enricher.
- `src/ingest.ts` — fixed local orchestration for historical ingestion.
- `src/sources/historical.ts` — small curated source registry; do not crawl the web.
- `src/db.ts` — the persistence adapter for durable conversations.

## Commands

- `npm run ingest:historical` — ingest the curated historical registry into `output/historical-cards.json`.
- `npm run ingest:one -- "<source URL>"` — test one approved source page locally.
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.
