# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/sf-ai-judge.ts` — the isolated Sol editorial judge.
- `src/instagram.ts` — the one-page ScrapeCreators Instagram source and strict native-coordinate gate.
- `src/ingest-instagram.ts` — local Flue orchestration that writes map pins.
- `public/data/sf-ai-pins.json` — the generated map data.
- `map.html` — the minimal Mapbox map.

## Commands

- `npm run ingest:instagram` — search one page of last-month Instagram Reels, judge them, and write map pins.
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.
