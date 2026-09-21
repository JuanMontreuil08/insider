import { fetchSanFranciscoAiTikToks } from './tiktok';
import { judgeVideos } from './judge';
import type { PinCollection, TikTokVideo } from './types';

interface Env {
	BUCKET: R2Bucket;
	SCRAPE_API_KEY: string;
	OPENAI_API_KEY: string;
	GOOGLE_MAPS_API_KEY?: string;
	MAPBOX_PUBLIC_TOKEN?: string;
	GEOAPIFY_API_KEY?: string;
}

const OUTPUT_KEY = 'sf-ai-tiktok-videos.json';
const DATE_POSTED = 'this-month' as const;
const NOTES_PREFIX = 'place-notes/';
const IMAGE_PREFIX = 'place-note-images/';

interface PlaceNote {
	id: string;
	place: string;
	placeId?: string;
	description: string;
	lat: number;
	lng: number;
	imageUrl: string | null;
	createdAt: string;
}

export default {
	async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
		ctx.waitUntil(ingest(env));
	},

	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const { pathname } = new URL(request.url);
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		if (pathname === '/data') {
			const obj = await env.BUCKET.get(OUTPUT_KEY);
			if (!obj) return new Response('No data yet', { status: 404, headers: corsHeaders });
			return new Response(obj.body, {
				headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
			});
		}

		if (pathname === '/config' && request.method === 'GET') {
			return Response.json({ googleMapsKey: env.GOOGLE_MAPS_API_KEY ?? '', mapboxToken: env.MAPBOX_PUBLIC_TOKEN ?? '' }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
		}

		if (pathname === '/places' && request.method === 'GET') {
			if (!env.GEOAPIFY_API_KEY) return Response.json({ error: 'Place search is not configured.' }, { status: 503, headers: corsHeaders });
			const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
			if (query.length < 3 || query.length > 100) return Response.json({ places: [] }, { headers: corsHeaders });
			const url = new URL('https://api.geoapify.com/v1/geocode/autocomplete');
			url.search = new URLSearchParams({ text: query, format: 'json', lang: 'en', limit: '6', filter: 'rect:-122.53,37.70,-122.35,37.83', apiKey: env.GEOAPIFY_API_KEY }).toString();
			const response = await fetch(url);
			if (!response.ok) return Response.json({ error: 'Place search is temporarily unavailable.' }, { status: 502, headers: corsHeaders });
			const data = await response.json() as { results?: Array<{ place_id?: string; name?: string; address_line1?: string; formatted?: string; lat?: number; lon?: number }> };
			const places = (data.results ?? []).filter((item) => typeof item.lat === 'number' && typeof item.lon === 'number' && item.lat >= 37.70 && item.lat <= 37.83 && item.lon >= -122.53 && item.lon <= -122.35).map((item) => ({ id: item.place_id ?? `${item.lat},${item.lon}`, name: item.name ?? item.address_line1 ?? item.formatted ?? 'Unknown place', address: item.formatted ?? '', lat: item.lat, lng: item.lon }));
			return Response.json({ places }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
		}

		if (pathname === '/notes' && request.method === 'GET') {
			const keys: string[] = [];
			let cursor: string | undefined;
			do {
				const page = await env.BUCKET.list({ prefix: NOTES_PREFIX, limit: 1000, cursor });
				keys.push(...page.objects.map((item) => item.key));
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
			const notes = (await Promise.all(keys.map(async (key) => {
				const object = await env.BUCKET.get(key);
				return object ? (await object.json()) as PlaceNote : null;
			}))).filter((note): note is PlaceNote => note !== null);
			notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
			return Response.json({ notes }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
		}

		if (pathname === '/notes' && request.method === 'POST') {
			if (Number(request.headers.get('content-length') ?? 0) > 5_500_000) return Response.json({ error: 'Photo is too large.' }, { status: 413, headers: corsHeaders });
			const form = await request.formData();
			const place = String(form.get('place') ?? '').trim();
			const placeId = String(form.get('placeId') ?? '').trim();
			const description = String(form.get('description') ?? '').trim();
			const lat = Number(form.get('lat'));
			const lng = Number(form.get('lng'));
			const image = form.get('image');
			const photo = image instanceof File && image.size > 0 ? image : null;
			if (!place || place.length > 80 || placeId.length > 255 || !description || description.length > 500 ||
				!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180 ||
				(photo !== null && (photo.size > 5_000_000 || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)))) {
				return Response.json({ error: 'Add a place and note. Optional photos must be JPG, PNG, or WebP under 5 MB.' }, { status: 400, headers: corsHeaders });
			}
			const id = crypto.randomUUID();
			let imageUrl: string | null = null;
			if (photo) {
				const extension = photo.type === 'image/png' ? 'png' : photo.type === 'image/webp' ? 'webp' : 'jpg';
				await env.BUCKET.put(`${IMAGE_PREFIX}${id}.${extension}`, photo.stream(), { httpMetadata: { contentType: photo.type } });
				imageUrl = `/note-images/${id}.${extension}`;
			}
			const note: PlaceNote = { id, place, ...(placeId ? { placeId } : {}), description, lat, lng, imageUrl, createdAt: new Date().toISOString() };
			await env.BUCKET.put(`${NOTES_PREFIX}${id}.json`, JSON.stringify(note));
			return Response.json(note, { status: 201, headers: corsHeaders });
		}

		if (pathname.startsWith('/note-images/') && request.method === 'GET') {
			const filename = pathname.slice('/note-images/'.length);
			if (!/^[a-f0-9-]{36}\.(jpg|png|webp)$/.test(filename)) return new Response('Not found', { status: 404, headers: corsHeaders });
			const image = await env.BUCKET.get(`${IMAGE_PREFIX}${filename}`);
			if (!image) return new Response('Not found', { status: 404, headers: corsHeaders });
			return new Response(image.body, { headers: { ...corsHeaders, 'Content-Type': image.httpMetadata?.contentType ?? 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
		}

		if (pathname === '/ingest') {
			const result = await ingest(env);
			return Response.json(result, { headers: corsHeaders });
		}

		return new Response('GET /data or POST /ingest', { status: 404, headers: corsHeaders });
	},
};

async function ingest(env: Env) {
	const today = new Date().toISOString().slice(0, 10);
	const previous = await readPins(env.BUCKET);
	const candidates = await fetchSanFranciscoAiTikToks(env.SCRAPE_API_KEY);
	const knownIds = new Set([
		...(previous?.seenReelIds ?? []),
		...(previous?.pins.map((p) => p.id) ?? []),
	]);
	const newCandidates = candidates.filter((c) => !knownIds.has(c.id));

	let newPins: TikTokVideo[] = [];
	if (newCandidates.length > 0) {
		const approved = await judgeVideos(env.OPENAI_API_KEY, newCandidates);
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

function mergeApproved(candidates: TikTokVideo[], approved: string[]): TikTokVideo[] {
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
