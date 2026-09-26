import { Buffer } from 'node:buffer';
import { fetchSanFranciscoAiTikToks } from './tiktok';
import type { PinCollection, ReelTranscript, TikTokIngestCandidate, TikTokVideo } from './types';
import { requireCurrentUser } from './auth';

interface Env {
	BUCKET: R2Bucket;
	DB: D1Database;
	ASSETS: Fetcher;
	AI: Ai;
	SCRAPE_API_KEY: string;
	CF_ACCESS_TEAM_DOMAIN?: string;
	CF_ACCESS_AUD?: string;
	MCP_URL?: string;
	PUBLIC_ORIGIN?: string;
	GOOGLE_MAPS_API_KEY?: string;
	GEOAPIFY_API_KEY?: string;
	CORS_ORIGINS?: string;
	INGEST_SECRET?: string;
	MCP_INTERNAL_SECRET?: string;
}

const OUTPUT_KEY = 'sf-ai-tiktok-videos.json';
const DATE_POSTED = 'this-month' as const;
const NOTES_PREFIX = 'place-notes/';
const IMAGE_PREFIX = 'place-note-images/';
const THUMB_PREFIX = 'thumbs/';
const TEMP_VIDEO_PREFIX = 'reels-temp/';
const TRANSCRIPT_PREFIX = 'reel-transcripts/';
const MEDIA_CACHE_CONCURRENCY = 3;
const TRANSCRIPTION_CONCURRENCY = 2;
const WHISPER_MODEL = '@cf/openai/whisper-large-v3-turbo' as const;
const rateLimits = new Map<string, number[]>();

interface PlaceNote {
	id: string;
	place: string;
	placeId?: string;
	address?: string;
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
		const requestUrl = new URL(request.url);
		const { pathname } = requestUrl;
		const origin = request.headers.get('Origin');
		const allowedOrigins = new Set((env.CORS_ORIGINS ?? requestUrl.origin).split(',').map((value) => value.trim()).filter(Boolean));
		const corsHeaders = {
			...(origin && allowedOrigins.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
			'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type, X-Ingest-Secret',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}


		if (pathname === '/internal/mcp/session' && request.method === 'POST') return activateMcpConnection(request, env);
		if (pathname === '/internal/mcp/tool' && request.method === 'POST') return handleInternalMcpTool(request, env, env.PUBLIC_ORIGIN ?? requestUrl.origin);

		if (pathname === '/me' && request.method === 'GET') {
			const user = await requireCurrentUser(request, env);
			if (!user) return unauthorizedJson(corsHeaders);
			const assigned = await env.DB.prepare('SELECT COUNT(*) AS count FROM reel_assignments WHERE user_id = ? AND viewed_at IS NULL').bind(user.id).first<{ count: number }>();
			const connection = await env.DB.prepare('SELECT 1 FROM hermes_connections WHERE user_id = ? LIMIT 1').bind(user.id).first();
			return Response.json({ email: user.email, newAssignments: assigned?.count ?? 0, hermesEnabled: Boolean(connection) }, { headers: corsHeaders });
		}

		if (pathname === '/me/assignments' && request.method === 'GET') {
			const user = await requireCurrentUser(request, env);
			if (!user) return unauthorizedJson(corsHeaders);
			const assignments = await env.DB.prepare('SELECT reel_id AS reelId, created_at AS createdAt, viewed_at AS viewedAt FROM reel_assignments WHERE user_id = ?').bind(user.id).all<{ reelId: string; createdAt: string; viewedAt: string | null }>();
			return Response.json({ assignments: assignments.results }, { headers: corsHeaders });
		}

		if (pathname === '/me/assignments' && request.method === 'POST') {
			const user = await requireCurrentUser(request, env);
			if (!user) return unauthorizedJson(corsHeaders);
			const connection = await env.DB.prepare('SELECT 1 FROM hermes_connections WHERE user_id = ? LIMIT 1').bind(user.id).first();
			if (!connection) return Response.json({ error: 'Connect Hermes before assigning Reels.' }, { status: 409, headers: corsHeaders });
			const body = await request.json<{ reelId?: unknown }>().catch(() => null);
			const reelId = typeof body?.reelId === 'string' ? body.reelId : '';
			if (!/^\d+$/.test(reelId)) return Response.json({ error: 'A numeric reelId is required.' }, { status: 400, headers: corsHeaders });
			const collection = await readPins(env.BUCKET);
			if (!collection?.pins.some((pin) => pin.id === reelId)) return Response.json({ error: 'Reel not found.' }, { status: 404, headers: corsHeaders });
			await env.DB.prepare('INSERT OR IGNORE INTO reel_assignments (user_id, reel_id) VALUES (?, ?)').bind(user.id, reelId).run();
			return Response.json({ reelId, assigned: true }, { status: 201, headers: corsHeaders });
		}

		if (pathname.startsWith('/me/assignments/') && request.method === 'DELETE') {
			const user = await requireCurrentUser(request, env);
			if (!user) return unauthorizedJson(corsHeaders);
			const reelId = pathname.slice('/me/assignments/'.length);
			if (!/^\d+$/.test(reelId)) return Response.json({ error: 'A numeric reelId is required.' }, { status: 400, headers: corsHeaders });
			await env.DB.prepare('DELETE FROM reel_assignments WHERE user_id = ? AND reel_id = ?').bind(user.id, reelId).run();
			return new Response(null, { status: 204, headers: corsHeaders });
		}

		if (pathname === '/data') {
			const obj = await env.BUCKET.get(OUTPUT_KEY);
			if (!obj) return new Response('No data yet', { status: 404, headers: corsHeaders });
			return new Response(obj.body, {
				headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
			});
		}

		if (pathname === '/config' && request.method === 'GET') {
			return Response.json({ googleMapsKey: env.GOOGLE_MAPS_API_KEY ?? '' }, { headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
		}

		if (pathname === '/places' && request.method === 'GET') {
			if (!allowRequest(request, 'places', 30, 60_000)) return Response.json({ error: 'Too many place searches. Try again shortly.' }, { status: 429, headers: corsHeaders });
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
			if (!allowRequest(request, 'notes', 10, 60 * 60_000)) return Response.json({ error: 'Too many notes submitted. Try again later.' }, { status: 429, headers: corsHeaders });
			if (Number(request.headers.get('content-length') ?? 0) > 5_500_000) return Response.json({ error: 'Photo is too large.' }, { status: 413, headers: corsHeaders });
			const form = await request.formData();
			const place = String(form.get('place') ?? '').trim();
			const placeId = String(form.get('placeId') ?? '').trim();
			const address = String(form.get('address') ?? '').trim();
			const description = String(form.get('description') ?? '').trim();
			const lat = Number(form.get('lat'));
			const lng = Number(form.get('lng'));
			const image = form.get('image');
			const photo = image instanceof File && image.size > 0 ? image : null;
			if (!place || place.length > 80 || placeId.length > 255 || address.length > 255 || !description || description.length > 500 ||
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
			const note: PlaceNote = { id, place, ...(placeId ? { placeId } : {}), ...(address ? { address } : {}), description, lat, lng, imageUrl, createdAt: new Date().toISOString() };
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

		if (pathname.startsWith('/thumbs/') && request.method === 'GET') {
			const id = pathname.slice('/thumbs/'.length);
			if (!/^[\w-]+$/.test(id)) return new Response('Not found', { status: 404, headers: corsHeaders });
			const obj = await env.BUCKET.get(`${THUMB_PREFIX}${id}.jpg`);
			if (!obj) return new Response('Not found', { status: 404, headers: corsHeaders });
			return new Response(obj.body, { headers: { ...corsHeaders, 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
		}

		if (pathname === '/ingest' && request.method === 'POST') {
			if (!env.INGEST_SECRET || request.headers.get('X-Ingest-Secret') !== env.INGEST_SECRET) return Response.json({ error: 'Manual ingestion is unauthorized.' }, { status: 401, headers: corsHeaders });
			if (!allowRequest(request, 'ingest', 1, 10 * 60_000)) return Response.json({ error: 'Ingestion was triggered recently. Try again later.' }, { status: 429, headers: corsHeaders });
			const result = await ingest(env);
			return Response.json(result, { headers: corsHeaders });
		}

		return env.ASSETS.fetch(request);
	},
};

async function activateMcpConnection(request: Request, env: Env) {
	if (!hasInternalMcpSecret(request, env)) return new Response('Not found', { status: 404 });
	const body = await request.json<{ accessSubject?: unknown; email?: unknown }>().catch(() => null);
	const accessSubject = typeof body?.accessSubject === 'string' ? body.accessSubject : '';
	const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
	if (!accessSubject || accessSubject.length > 255 || !email || email.length > 255) return Response.json({ error: 'Invalid identity.' }, { status: 400 });
	await env.DB.batch([
		env.DB.prepare('INSERT OR IGNORE INTO users (id, access_subject, email) VALUES (?, ?, ?)').bind(crypto.randomUUID(), accessSubject, email),
		env.DB.prepare('UPDATE users SET email = ? WHERE access_subject = ?').bind(email, accessSubject),
	]);
	const user = await env.DB.prepare('SELECT id FROM users WHERE access_subject = ?').bind(accessSubject).first<{ id: string }>();
	if (!user) return Response.json({ error: 'User was not created.' }, { status: 500 });
	await env.DB.prepare("INSERT INTO hermes_connections (user_id, connected_at, updated_at) VALUES (?, datetime('now'), datetime('now')) ON CONFLICT(user_id) DO UPDATE SET updated_at = datetime('now')").bind(user.id).run();
	return Response.json({ userId: user.id });
}

async function handleInternalMcpTool(request: Request, env: Env, origin: string) {
	if (!hasInternalMcpSecret(request, env)) return new Response('Not found', { status: 404 });
	const body = await request.json<{ userId?: unknown; tool?: unknown; input?: unknown }>().catch(() => null);
	const userId = typeof body?.userId === 'string' ? body.userId : '';
	const tool = typeof body?.tool === 'string' ? body.tool : '';
	if (!userId) return Response.json({ error: 'Invalid user.' }, { status: 400 });
	if (tool === 'new-reels') {
		const limit = typeof (body?.input as { limit?: unknown } | null)?.limit === 'number' ? (body!.input as { limit: number }).limit : 10;
		if (!Number.isInteger(limit) || limit < 1 || limit > 10) return Response.json({ error: 'Invalid limit.' }, { status: 400 });
		const assigned = await getNewAssignments(env.DB, userId, limit);
		const collection = await readPins(env.BUCKET);
		const byId = new Map(collection?.pins.map((pin) => [pin.id, pin]) ?? []);
		const reels = await Promise.all(assigned.map((reelId) => reelPayload(env.BUCKET, origin, byId.get(reelId))));
		return Response.json({ payload: { reels: reels.filter(Boolean), ...(assigned.length ? {} : { message: 'No newly assigned Insider reels.' }) } });
	}
	if (tool === 'mark-viewed') {
		const reelIds = (body?.input as { reelIds?: unknown } | null)?.reelIds;
		if (!Array.isArray(reelIds) || !reelIds.length || reelIds.length > 10 || reelIds.some((id) => typeof id !== 'string' || !/^\d+$/.test(id))) return Response.json({ error: 'Invalid reel IDs.' }, { status: 400 });
		await Promise.all(reelIds.map((reelId) => markAssignmentViewed(env.DB, userId, reelId)));
		return Response.json({ payload: { message: 'Marked assigned reels as viewed.' } });
	}
	if (tool === 'get-reel') {
		const reelId = (body?.input as { reelId?: unknown } | null)?.reelId;
		if (typeof reelId !== 'string' || !/^\d+$/.test(reelId)) return Response.json({ error: 'Invalid reel ID.' }, { status: 400 });
		if (!await hasAssignment(env.DB, userId, reelId)) return Response.json({ error: 'That reel is not assigned to this user.' }, { status: 403 });
		const collection = await readPins(env.BUCKET);
		const reel = collection?.pins.find((pin) => pin.id === reelId);
		if (!reel) return Response.json({ error: 'No Insider reel exists with that ID.' }, { status: 404 });
		return Response.json({ payload: await reelPayload(env.BUCKET, origin, reel) });
	}
	return Response.json({ error: 'Unknown MCP tool.' }, { status: 400 });
}

function hasInternalMcpSecret(request: Request, env: Env) {
	return Boolean(env.MCP_INTERNAL_SECRET) && request.headers.get('X-MCP-Internal-Secret') === env.MCP_INTERNAL_SECRET;
}

async function getNewAssignments(db: D1Database, userId: string, limit: number) {
	const result = await db.prepare('SELECT reel_id FROM reel_assignments WHERE user_id = ? AND viewed_at IS NULL ORDER BY created_at DESC LIMIT ?').bind(userId, limit).all<{ reel_id: string }>();
	return result.results.map((row) => row.reel_id);
}

async function hasAssignment(db: D1Database, userId: string, reelId: string) {
	return Boolean(await db.prepare('SELECT 1 FROM reel_assignments WHERE user_id = ? AND reel_id = ?').bind(userId, reelId).first());
}

async function markAssignmentViewed(db: D1Database, userId: string, reelId: string) {
	await db.prepare("UPDATE reel_assignments SET viewed_at = COALESCE(viewed_at, datetime('now')) WHERE user_id = ? AND reel_id = ?").bind(userId, reelId).run();
}

async function reelPayload(bucket: R2Bucket, origin: string, reel: TikTokVideo | undefined) {
	if (!reel) return null;
	const transcriptObject = await bucket.get(`${TRANSCRIPT_PREFIX}${reel.id}.json`);
	const transcript = transcriptObject ? await transcriptObject.json<ReelTranscript>() : null;
	return {
		reel: {
			id: reel.id, platform: reel.platform, url: reel.url, username: reel.username, caption: reel.caption,
			publishedAt: reel.publishedAt, likeCount: reel.likeCount, commentCount: reel.commentCount,
			thumbnailUrl: reel.thumbnailKey ? `${origin}${reel.thumbnailKey}` : null,
			video: { durationSeconds: reel.videoDurationSeconds ?? null, width: reel.videoWidth ?? null, height: reel.videoHeight ?? null, cachedForOneDay: reel.videoCached === true, originalUrl: reel.url },
		},
		transcript: transcript ? { status: transcript.status, language: transcript.language, text: transcript.text, segments: transcript.segments, generatedAt: transcript.generatedAt } : {
			status: reel.transcriptStatus ?? 'unavailable', language: reel.transcriptLanguage ?? null, text: null, segments: [], generatedAt: null,
		},
	};
}

function unauthorizedJson(corsHeaders: Record<string, string>) {
	return Response.json({ error: 'Sign in to Insider to continue.' }, { status: 401, headers: corsHeaders });
}

async function ingest(env: Env) {
	const today = new Date().toISOString().slice(0, 10);
	const previous = await readPins(env.BUCKET);
	const candidates = await fetchSanFranciscoAiTikToks(env.SCRAPE_API_KEY);
	const knownIds = new Set([
		...(previous?.seenReelIds ?? []),
		...(previous?.pins.map((p) => p.id) ?? []),
	]);
	const newCandidates = candidates.filter((candidate) => !knownIds.has(candidate.video.id));
	const newVideos = newCandidates.map((candidate) => candidate.video);
	await Promise.all([
		cacheThumbnails(env.BUCKET, newVideos),
		cacheVideos(env.BUCKET, newCandidates),
		transcribeVideos(env, newCandidates),
	]);
	const pins = [...(previous?.pins ?? []), ...newVideos];
	const output: PinCollection = {
		generatedAt: new Date().toISOString(),
		query: 'San Francisco AI',
		datePosted: DATE_POSTED,
		lastSearchedOn: today,
		seenReelIds: [...new Set([...knownIds, ...candidates.map((candidate) => candidate.video.id)])],
		candidates: candidates.length,
		pins,
	};

	await env.BUCKET.put(OUTPUT_KEY, JSON.stringify(output, null, 2));

	return {
		candidates: candidates.length,
		new: newVideos.length,
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

async function cacheThumbnails(bucket: R2Bucket, videos: TikTokVideo[]) {
	await forEachConcurrent(videos, MEDIA_CACHE_CONCURRENCY, async (video) => {
			if (!video.thumbnailUrl) return;
			try {
				const res = await fetch(video.thumbnailUrl, { signal: AbortSignal.timeout(10_000) });
				if (!res.ok || !res.body) return;
				const key = `${THUMB_PREFIX}${video.id}.jpg`;
				await bucket.put(key, res.body, { httpMetadata: { contentType: 'image/jpeg' } });
				video.thumbnailKey = `/thumbs/${video.id}`;
			} catch (error) {
				console.error('Thumbnail caching failed', { reelId: video.id, error: errorMessage(error) });
			}
	});
}

async function cacheVideos(bucket: R2Bucket, candidates: TikTokIngestCandidate[]) {
	await forEachConcurrent(candidates, MEDIA_CACHE_CONCURRENCY, async (candidate) => {
		if (!candidate.playbackUrl) return;
		try {
			const response = await fetch(candidate.playbackUrl, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
			if (!response.ok || !response.body) return;
			await bucket.put(`${TEMP_VIDEO_PREFIX}${candidate.video.id}.mp4`, response.body, {
				httpMetadata: { contentType: response.headers.get('content-type') ?? 'video/mp4' },
				customMetadata: { cachedAt: new Date().toISOString(), source: 'scrapecreators' },
			});
			candidate.video.videoCached = true;
		} catch (error) {
			console.error('Video caching failed', { reelId: candidate.video.id, error: errorMessage(error) });
		}
	});
}

async function transcribeVideos(env: Env, candidates: TikTokIngestCandidate[]) {
	await forEachConcurrent(candidates, TRANSCRIPTION_CONCURRENCY, async (candidate) => {
		if (!candidate.audioUrl) {
			candidate.video.transcriptStatus = 'unavailable';
			return;
		}

		try {
			const audioResponse = await fetch(candidate.audioUrl, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
			if (!audioResponse.ok) {
				candidate.video.transcriptStatus = 'unavailable';
				return;
			}

			const audio = Buffer.from(await audioResponse.arrayBuffer()).toString('base64');
			const result = await env.AI.run(WHISPER_MODEL, {
				audio,
				task: 'transcribe',
				vad_filter: true,
				no_speech_threshold: 0.6,
			});
			const text = result.text.trim();
			const status = text ? 'ready' : 'no_speech';
			const transcript: ReelTranscript = {
				reelId: candidate.video.id,
				status,
				text: text || null,
				language: result.transcription_info?.language ?? null,
				wordCount: result.word_count ?? null,
				vtt: result.vtt ?? null,
				segments: (result.segments ?? []).map((segment) => ({
					start: segment.start ?? null,
					end: segment.end ?? null,
					text: segment.text?.trim() ?? '',
				})),
				generatedAt: new Date().toISOString(),
				model: WHISPER_MODEL,
			};
			await env.BUCKET.put(`${TRANSCRIPT_PREFIX}${candidate.video.id}.json`, JSON.stringify(transcript), {
				httpMetadata: { contentType: 'application/json' },
			});
			candidate.video.transcriptStatus = status;
			candidate.video.transcriptLanguage = transcript.language;
			candidate.video.transcriptWordCount = transcript.wordCount;
		} catch (error) {
			console.error('Transcription failed', { reelId: candidate.video.id, error: errorMessage(error) });
			candidate.video.transcriptStatus = 'failed';
		}
	});
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function allowRequest(request: Request, bucket: string, limit: number, windowMs: number) {
	const key = `${bucket}:${request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For') ?? 'unknown'}`;
	const now = Date.now();
	const recent = (rateLimits.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
	if (recent.length >= limit) {
		rateLimits.set(key, recent);
		return false;
	}
	recent.push(now);
	rateLimits.set(key, recent);
	return true;
}

async function forEachConcurrent<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
	let nextIndex = 0;
	async function worker() {
		while (nextIndex < items.length) {
			const item = items[nextIndex++];
			await task(item);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}
