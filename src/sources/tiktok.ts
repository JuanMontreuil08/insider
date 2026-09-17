import type { TikTokVideo } from '../schemas.ts';

const API = 'https://api.scrapecreators.com';

interface TikTokSearchParams {
	query: string;
	sort_by?: string;
	date_posted?: string;
	region?: string;
	cursor?: string;
}

interface TikTokApiResponse {
	success: boolean;
	credits_remaining: number;
	search_item_list: TikTokSearchItem[];
}

interface TikTokSearchItem {
	aweme_info: {
		aweme_id: string;
		desc: string;
		author: { nickname: string; unique_id: string };
		statistics: {
			play_count: number;
			digg_count: number;
			share_count: number;
			comment_count: number;
		};
	};
}

/** Default search config targeting SF/SV viral content. */
export const TIKTOK_DEFAULT_PARAMS: TikTokSearchParams = {
	query: 'san francisco ai',
	sort_by: 'most-liked',
	date_posted: 'this-month',
};

/**
 * Fetches TikTok videos from the ScrapeCreators keyword search endpoint
 * and returns a compact array of TikTokVideo objects.
 */
export async function fetchTikTokVideos(
	apiKey: string,
	params: TikTokSearchParams = TIKTOK_DEFAULT_PARAMS,
): Promise<TikTokVideo[]> {
	const url = new URL(`${API}/v1/tiktok/search/keyword`);
	for (const [k, v] of Object.entries(params)) {
		if (v) url.searchParams.set(k, v);
	}

	const response = await fetch(url, {
		headers: { 'x-api-key': apiKey },
		signal: AbortSignal.timeout(30_000),
	});

	if (!response.ok) throw new Error(`TikTok API returned HTTP ${response.status}.`);

	const data = (await response.json()) as TikTokApiResponse;
	console.log(`  Credits remaining: ${data.credits_remaining}`);

	if (!data.success || !Array.isArray(data.search_item_list)) {
		throw new Error('TikTok API returned an unsuccessful or malformed response.');
	}

	return data.search_item_list.map((item): TikTokVideo => ({
		aweme_id: item.aweme_info.aweme_id,
		desc: item.aweme_info.desc,
		author: item.aweme_info.author?.nickname ?? item.aweme_info.author?.unique_id ?? 'unknown',
		play_count: item.aweme_info.statistics.play_count,
		digg_count: item.aweme_info.statistics.digg_count,
		share_count: item.aweme_info.statistics.share_count,
		comment_count: item.aweme_info.statistics.comment_count,
	}));
}

/**
 * Filters out videos whose aweme_id already exists in the given set.
 */
export function dedup(videos: TikTokVideo[], existingIds: Set<string>): TikTokVideo[] {
	return videos.filter((v) => !existingIds.has(v.aweme_id));
}
