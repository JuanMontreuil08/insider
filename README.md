# SF AI Pulse

A map of San Francisco AI and startup culture, using only Instagram Reels with
creator-tagged native coordinates.

## First slice

`npm run ingest:instagram` makes one ScrapeCreators request:

- query: `San Francisco AI`
- date window: `last-month`
- page: `1`

It rejects every Reel without `location.lat` and `location.lng`, excludes
coordinates outside San Francisco, then sends the small candidate batch to the
Flue Sol judge. The result is saved to `public/data/sf-ai-pins.json`.

Required `.env` values:

```sh
SCRAPE_API_KEY=...
OPENAI_API_KEY=...
```

To render the map, put a domain-restricted public Mapbox token in
`public/config.js`, then serve this repository through any local static server
and open `/map.html`.

Pins are creator-tagged Instagram locations, not asserted recording GPS.
