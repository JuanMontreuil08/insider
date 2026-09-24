export interface TikTokVideo {
	id: string;
	platform: 'tiktok';
	url: string;
	username: string;
	caption: string;
	thumbnailUrl: string | null;
	/** R2 key for the cached thumbnail, served via /thumbs/:id */
	thumbnailKey?: string | null;
	/** Video metadata from the source. The R2 video key intentionally stays private. */
	videoDurationSeconds?: number | null;
	videoWidth?: number | null;
	videoHeight?: number | null;
	videoSizeBytes?: number | null;
	videoCached?: boolean;
	publishedAt: string;
	likeCount: number;
	commentCount: number;
}

/**
 * Source-only details used while ingesting. Do not persist this object in the
 * public catalog: TikTok CDN playback URLs expire and must not be exposed.
 */
export interface TikTokIngestCandidate {
	video: TikTokVideo;
	playbackUrl: string | null;
}

export interface PinCollection {
	generatedAt: string;
	query: string;
	datePosted: 'this-month';
	lastSearchedOn?: string;
	seenReelIds?: string[];
	candidates: number;
	pins: TikTokVideo[];
}
