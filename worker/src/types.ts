export interface InstagramLocation {
	pk: string | null;
	name: string;
	lat: number | null;
	lng: number | null;
}

export interface InstagramReel {
	id: string;
	shortcode: string;
	url: string;
	username: string;
	caption: string;
	thumbnailUrl: string | null;
	publishedAt: string;
	likeCount: number;
	commentCount: number;
	location: InstagramLocation | null;
}

export interface PinCollection {
	generatedAt: string;
	query: string;
	datePosted: 'last-month' | 'last-week';
	lastSearchedOn?: string;
	seenReelIds?: string[];
	candidates: number;
	pins: InstagramReel[];
}
