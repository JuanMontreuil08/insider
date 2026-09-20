import { fetchSanFranciscoAiReels } from './instagram';
import { judgeReels } from './judge';
import type { InstagramReel, PinCollection } from './types';

interface Env {
	BUCKET: R2Bucket;
	SCRAPE_API_KEY: string;
	OPENAI_API_KEY: string;
}

const OUTPUT_KEY = 'sf-ai-pins.json';
const DATE_POSTED = 'last-week' as const;

export default {
	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(ingest(env));
	},

	// Manual trigger via HTTP for testing
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		if (new URL(request.url).pathname !== '/ingest') {
			return new Response('POST /ingest to trigger manually', { status: 404 });
		}
		const result = await ingest(env);
		return Response.json(result);
	},
};

async function ingest(env: Env) {
	const today = new Date().toISOString().slice(0, 10);
	const previous = await readPins(env.BUCKET);
	const candidates = await fetchSanFranciscoAiReels(env.SCRAPE_API_KEY);
	const knownIds = new Set([
		...(previous?.seenReelIds ?? []),
		...(previous?.pins.map((p) => p.id) ?? []),
	]);
	const newCandidates = candidates.filter((c) => !knownIds.has(c.id));

	let newPins: InstagramReel[] = [];
	if (newCandidates.length > 0) {
		const approved = await judgeReels(env.OPENAI_API_KEY, newCandidates);
		newPins = mergeApproved(newCandidates, approved);
	}

	const pins = [...(previous?.pins ?? []), ...newPins];
	const output: PinCollection = {
		generatedAt: new Date().toISOString(),
		query: 'San Francisco AI',
		datePosted: DATE_POSTED,
		lastSearchedOn: today,
		seenReelIds: [...new Set([...knownIds, ...candidates.map((c) => c.id)])],
		candidates: candidates.length,
		pins,
	};

	await env.BUCKET.put(OUTPUT_KEY, JSON.stringify(output, null, 2));

	return {
		candidates: candidates.length,
		newCandidates: newCandidates.length,
		added: newPins.length,
		totalPins: pins.length,
	};
}

async function readPins(bucket: R2Bucket): Promise<PinCollection | null> {
	const obj = await bucket.get(OUTPUT_KEY);
	if (!obj) return null;
	const data = (await obj.json()) as PinCollection;
	if (!Array.isArray(data.pins)) throw new Error('Existing pin file is malformed.');
	return data;
}

function mergeApproved(candidates: InstagramReel[], approved: string[]): InstagramReel[] {
	if (!Array.isArray(approved)) throw new Error('Judge must return an array.');
	const byId = new Map(candidates.map((c) => [c.id, c]));
	const seen = new Set<string>();
	return approved.map((id) => {
		const candidate = byId.get(id);
		if (typeof id !== 'string' || !candidate || seen.has(id)) {
			throw new Error(`Judge returned an invalid result for id=${id}.`);
		}
		seen.add(id);
		return candidate;
	});
}
