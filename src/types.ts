export interface InstagramLocation {
	pk: string;
	name: string;
	lat: number;
	lng: number;
}

export interface InstagramReel {
	id: string;
	shortcode: string;
	url: string;
	username: string;
	profileUrl: string;
	caption: string;
	thumbnailUrl: string | null;
	publishedAt: string;
	likeCount: number;
	commentCount: number;
	location: InstagramLocation;
}

export interface JudgedReel {
	id: string;
	title: string;
	description: string;
}

export interface MapPin extends InstagramReel, JudgedReel {}

export interface PinCollection {
	generatedAt: string;
	query: string;
	datePosted: 'last-month';
	candidates: number;
	pins: MapPin[];
}
