/**
 * SF/SV discovery test — 7 API calls, 7 credits.
 * All calls target San Francisco / Silicon Valley specifically.
 *
 * Strategy:
 *   1. Local communities (3) — SF/Bay Area/SV subreddits, what locals discuss
 *   2. Tech journalist   (1) — SF tech insider signal
 *   3. Territory sweep   (3) — TikTok keyword nets scoped to SF/SV
 *
 * Run: node --env-file=.env --experimental-strip-types src/test-scrape.ts
 */

const API = 'https://api.scrapecreators.com';
const KEY = process.env.SCRAPE_API_KEY!;

interface Call {
	name: string;
	path: string;
	params: Record<string, string>;
}

const calls: Call[] = [
	// --- Local communities ---
	{
		name: 'reddit-sanfrancisco',
		path: '/v1/reddit/subreddit',
		params: { subreddit: 'sanfrancisco', sort: 'top', timeframe: 'week' },
	},
	{
		name: 'reddit-bayarea',
		path: '/v1/reddit/subreddit',
		params: { subreddit: 'bayarea', sort: 'top', timeframe: 'week' },
	},
	// --- Tech journalist ---
	{
		name: 'twitter-ericnewcomer',
		path: '/v1/twitter/user-tweets',
		params: { handle: 'EricNewcomer' },
	},

	// --- Territory sweep (TikTok, recent + most engaged) ---
	{
		name: 'tiktok-sf-founders',
		path: '/v1/tiktok/search/keyword',
		params: { query: 'sf founders', sort_by: 'most-liked', date_posted: 'this-month' },
	},
	{
		name: 'tiktok-san-francisco-ai',
		path: '/v1/tiktok/search/keyword',
		params: { query: 'san francisco ai', sort_by: 'most-liked', date_posted: 'this-month' },
	},
	{
		name: 'tiktok-silicon-valley',
		path: '/v1/tiktok/search/keyword',
		params: { query: 'silicon valley', sort_by: 'most-liked', date_posted: 'this-month' },
	},
];

async function fetchOne(call: Call) {
	const url = new URL(API + call.path);
	for (const [k, v] of Object.entries(call.params)) url.searchParams.set(k, v);

	console.log(`→ ${call.name}`);
	const res = await fetch(url, { headers: { 'x-api-key': KEY } });
	const json = await res.json();
	console.log(`  ${res.status} — credits left: ${(json as any).credits_remaining ?? '?'}`);
	return json;
}

async function main() {
	const fs = await import('node:fs');
	fs.mkdirSync('output/discovery', { recursive: true });

	for (const call of calls) {
		const data = await fetchOne(call);
		fs.writeFileSync(`output/discovery/${call.name}.json`, JSON.stringify(data, null, 2));
	}

	console.log('\n✓ Done — check output/discovery/');
}

main().catch(console.error);
