import { detect } from 'tinyld';
import type { TikTokIngestCandidate } from './types';

const API = 'https://api.scrapecreators.com/v1/tiktok/search/keyword';
const DATE_POSTED = 'this-month';
const SORT_BY = 'most-liked';

interface RawTikTokVideo {
	aweme_id?: string | number;
	desc?: string;
	create_time?: number;
	create_time_utc?: string;
	url?: string;
	author?: { nickname?: string; unique_id?: string };
	statistics?: { digg_count?: number; comment_count?: number };
	video?: {
		cover?: { url_list?: string[] };
		play_addr?: RawMediaAddress;
		duration?: number;
		width?: number;
		height?: number;
	};
}

interface RawMediaAddress {
	url_list?: string[];
	data_size?: number;
}

interface SearchItem {
	aweme_info?: RawTikTokVideo;
}

interface SearchResponse {
	success: boolean;
	search_item_list?: SearchItem[];
}

export async function fetchSanFranciscoAiTikToks(apiKey: string): Promise<TikTokIngestCandidate[]> {
	const url = new URL(API);
	url.searchParams.set('query', 'San Francisco AI');
	url.searchParams.set('date_posted', DATE_POSTED);
	url.searchParams.set('sort_by', SORT_BY);
	url.searchParams.set('region', 'US');

	const response = await fetch(url, {
		headers: { 'x-api-key': apiKey },
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`TikTok search returned HTTP ${response.status}.`);

	const data = (await response.json()) as SearchResponse;
	if (!data.success || !Array.isArray(data.search_item_list)) {
		throw new Error('TikTok search returned an unsuccessful or malformed response.');
	}

	const candidates = new Map<string, TikTokIngestCandidate>();
	for (const item of data.search_item_list) {
		const candidate = toCandidateVideo(item.aweme_info);
		if (candidate) candidates.set(candidate.video.id, candidate);
	}
	return [...candidates.values()].filter(isEnglishOrSpanish);
}

const ALLOWED_LANGS = new Set(['en', 'es']);

function isEnglishOrSpanish(candidate: TikTokIngestCandidate): boolean {
	// Strip hashtags and mentions for cleaner detection
	const cleaned = candidate.video.caption.replace(/#\S+/g, '').replace(/@\S+/g, '').trim();
	// Short or hashtag-heavy captions are unreliable — allow them through
	if (cleaned.length < 40) return true;
	const lang = detect(cleaned);
	return ALLOWED_LANGS.has(lang);
}

function toCandidateVideo(video: RawTikTokVideo | undefined): TikTokIngestCandidate | null {
	const id = video?.aweme_id ? String(video.aweme_id) : null;
	const username = video?.author?.unique_id?.trim() || video?.author?.nickname?.trim() || null;
	const caption = video?.desc?.trim();
	const publishedAt = video?.create_time_utc ?? (typeof video?.create_time === 'number' ? new Date(video.create_time * 1000).toISOString() : null);

	if (!id || !video?.url || !username || !caption || !publishedAt || Number.isNaN(Date.parse(publishedAt))) return null;

	const duration = video.video?.duration;
	return {
		video: {
			id,
			platform: 'tiktok',
			url: video.url,
			username,
			caption,
			thumbnailUrl: video.video?.cover?.url_list?.[0] ?? null,
			videoDurationSeconds: typeof duration === 'number' ? duration / 1_000 : null,
			videoWidth: video.video?.width ?? null,
			videoHeight: video.video?.height ?? null,
			videoSizeBytes: video.video?.play_addr?.data_size ?? null,
			publishedAt,
			likeCount: video.statistics?.digg_count ?? 0,
			commentCount: video.statistics?.comment_count ?? 0,
		},
		playbackUrl: video.video?.play_addr?.url_list?.[0] ?? null,
	};
}
