import type { InstagramReel } from './types.ts';

const API = 'https://api.scrapecreators.com/v2/instagram/reels/search';

// Deliberately broad enough to include every SF tag, but narrow enough to
// exclude Oakland, San Jose, and the wider Bay Area from this first map.
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
	url.searchParams.set('date_posted', 'last-month');
	url.searchParams.set('page', '1');

	const response = await fetch(url, {
		headers: { 'x-api-key': apiKey },
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`Instagram search returned HTTP ${response.status}.`);

	const data = (await response.json()) as SearchResponse;
	if (!data.success || !Array.isArray(data.reels)) {
		throw new Error('Instagram search returned an unsuccessful or malformed response.');
	}

	console.log(`Instagram search charged ${data.credits_charged ?? 'an unknown number of'} credit(s).`);
	return data.reels.flatMap(toNativeLocationReel);
}

function toNativeLocationReel(reel: RawReel): InstagramReel[] {
	const location = reel.location;
	const username = reel.owner?.username?.trim();
	const lat = location?.lat;
	const lng = location?.lng;
	if (
		!location ||
		typeof lat !== 'number' ||
		typeof lng !== 'number' ||
		!Number.isFinite(lat) ||
		!Number.isFinite(lng) ||
		!location.name?.trim() ||
		!location.pk ||
		!reel.id ||
		!reel.shortcode ||
		!reel.url ||
		!username ||
		!reel.caption?.trim() ||
		!isInsideSanFrancisco(lat, lng)
	) {
		return [];
	}

	return [
		{
			id: String(reel.id),
			shortcode: reel.shortcode,
			url: reel.url,
			username,
			profileUrl: `https://www.instagram.com/${username}/`,
			caption: reel.caption,
			thumbnailUrl: reel.thumbnail_src ?? null,
			publishedAt: reel.taken_at ?? '',
			likeCount: reel.like_count ?? 0,
			commentCount: reel.comment_count ?? 0,
			location: { pk: String(location.pk), name: location.name, lat, lng },
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
