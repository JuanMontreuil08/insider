import type { InstagramReel } from './types.ts';

const API = 'https://api.scrapecreators.com/v2/instagram/reels/search';
export const DATE_POSTED = 'last-week' as const;

// Reject an explicitly tagged location outside SF; an absent tag is allowed.
const SAN_FRANCISCO_BOUNDS = {
	minLat: 37.70,
	maxLat: 37.84,
	minLng: -122.53,
	maxLng: -122.34,
};

interface RawReel {
	id?: string | number;
	shortcode?: string;
	url?: string;
	caption?: string;
	thumbnail_src?: string;
	taken_at?: string;
	like_count?: number;
	comment_count?: number;
	owner?: { username?: string };
	location?: {
		pk?: string | number;
		id?: string | number;
		name?: string;
		lat?: number;
		lng?: number;
	} | null;
}

interface SearchResponse {
	success: boolean;
	credits_charged?: number;
	reels?: RawReel[];
}

export async function fetchSanFranciscoAiReels(apiKey: string): Promise<InstagramReel[]> {
	const url = new URL(API);
	url.searchParams.set('query', 'San Francisco AI');
	url.searchParams.set('date_posted', DATE_POSTED);
	const candidates = new Map<string, InstagramReel>();
	let creditsCharged = 0;
	for (let page = 1; page <= 11; page++) {
		url.searchParams.set('page', String(page));
		const response = await fetch(url, {
			headers: { 'x-api-key': apiKey },
			signal: AbortSignal.timeout(30_000),
		});
		if (response.status === 404 && page > 1) break;
		if (!response.ok) throw new Error(`Instagram search page ${page} returned HTTP ${response.status}.`);

		const data = (await response.json()) as SearchResponse;
		if (!data.success || !Array.isArray(data.reels)) {
			throw new Error(`Instagram search page ${page} returned an unsuccessful or malformed response.`);
		}
		creditsCharged += data.credits_charged ?? 0;
		for (const reel of data.reels.flatMap(toCandidateReel)) candidates.set(reel.id, reel);
		console.log(`Instagram page ${page}: ${data.reels.length} raw Reels, ${candidates.size} unique SF candidates so far.`);
		if (data.reels.length === 0) break;
	}
	console.log(`Instagram search charged ${creditsCharged} reported credit(s).`);
	return [...candidates.values()];
}

function toCandidateReel(reel: RawReel): InstagramReel[] {
	const location = reel.location;
	const username = reel.owner?.username?.trim();
	const lat = location?.lat;
	const lng = location?.lng;
	const hasCoordinates = typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng);
	if (
		!reel.id ||
		!reel.shortcode ||
		!reel.url ||
		!username ||
		!reel.caption?.trim() ||
		!reel.taken_at ||
		Number.isNaN(Date.parse(reel.taken_at)) ||
		(hasCoordinates && !isInsideSanFrancisco(lat, lng))
	) {
		return [];
	}

	return [
		{
			id: String(reel.id),
			shortcode: reel.shortcode,
			url: reel.url,
			username,
			caption: reel.caption,
			thumbnailUrl: reel.thumbnail_src ?? null,
			publishedAt: reel.taken_at,
			likeCount: reel.like_count ?? 0,
			commentCount: reel.comment_count ?? 0,
			location: location?.name?.trim() ? {
				pk: location.pk || location.id ? String(location.pk ?? location.id) : null,
				name: location.name.trim(),
				lat: hasCoordinates ? lat : null,
				lng: hasCoordinates ? lng : null,
			} : null,
		},
	];
}

function isInsideSanFrancisco(lat: number, lng: number): boolean {
	return (
		lat >= SAN_FRANCISCO_BOUNDS.minLat &&
		lat <= SAN_FRANCISCO_BOUNDS.maxLat &&
		lng >= SAN_FRANCISCO_BOUNDS.minLng &&
		lng <= SAN_FRANCISCO_BOUNDS.maxLng
	);
}
