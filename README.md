# SF AI Pulse

A searchable catalog of Instagram Reels about San Francisco AI and startup
culture. Search matches caption text; cards show the caption, publication date,
creator, and a location tag when one is present.

## Daily ingestion

`npm run ingest:instagram` searches successive ScrapeCreators pages until the
results end (at most 11 pages):

- query: `San Francisco AI`
- date window: `last-week`

Run it once per UTC date. A second run on the same date skips the API request.
Reels already seen on earlier runs are deduplicated by ID before judging, and
new approved Reels are added to the existing collection.

It requires a caption, creator, Reel URL, and publication date. Location tags
are optional; explicitly tagged coordinates outside San Francisco are excluded.
New candidates go to the Flue Sol judge. Sol returns only approved Reel IDs;
it does not generate card copy. The result is saved to
`public/data/sf-ai-pins.json`.

Each persisted Reel preserves the original caption, thumbnail, publication
date, creator, URL, and any native location tag. Cards with no location tag
simply omit that detail.

Required `.env` values:

```sh
SCRAPE_API_KEY=...
OPENAI_API_KEY=...
```

Serve this repository through any local static server and open `/map.html`.
