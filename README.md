# insider

A [Flue](https://flueframework.com) agent project.

## Setup

```sh
npm install
```

Then add a model provider API key to `.env` (any [provider Pi supports](https://pi.dev/docs/latest/providers#api-keys)).

## Run historical ingestion

```sh
npm run ingest:historical
```

The run ingests the small, curated Stanford + Computer History Museum registry.
Each source page can produce at most one card; final cards are written to
`output/historical-cards.json`.

To test one approved source page without processing the full registry:

```sh
npm run ingest:one -- "https://library.stanford.edu/news/celebrating-silicon-genesis"
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
