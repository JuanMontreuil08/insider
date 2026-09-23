export interface TikTokVideo {
	id: string;
	platform: 'tiktok';
	url: string;
	username: string;
	caption: string;
	thumbnailUrl: string | null;
	/** R2 key for the cached thumbnail, served via /thumbs/:id */
	thumbnailKey?: string | null;
	publishedAt: string;
	likeCount: number;
	commentCount: number;
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
