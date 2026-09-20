import type { InstagramReel } from './types';

const API = 'https://api.scrapecreators.com/v2/instagram/reels/search';
const DATE_POSTED = 'last-week';

const SF_BOUNDS = { minLat: 37.70, maxLat: 37.84, minLng: -122.53, maxLng: -122.34 };

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
		for (const reel of data.reels.flatMap(toCandidateReel)) candidates.set(reel.id, reel);
		if (data.reels.length === 0) break;
	}

	return [...candidates.values()];
}

function toCandidateReel(reel: RawReel): InstagramReel[] {
	const location = reel.location;
	const username = reel.owner?.username?.trim();
	const lat = location?.lat;
	const lng = location?.lng;
	const hasCoords = typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng);

	if (
		!reel.id ||
		!reel.shortcode ||
		!reel.url ||
		!username ||
		!reel.caption?.trim() ||
		!reel.taken_at ||
		Number.isNaN(Date.parse(reel.taken_at)) ||
		(hasCoords && !(lat >= SF_BOUNDS.minLat && lat <= SF_BOUNDS.maxLat && lng >= SF_BOUNDS.minLng && lng <= SF_BOUNDS.maxLng))
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
			location: location?.name?.trim()
				? {
						pk: location.pk || location.id ? String(location.pk ?? location.id) : null,
						name: location.name.trim(),
						lat: hasCoords ? lat : null,
						lng: hasCoords ? lng : null,
					}
				: null,
		},
	];
}
