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
	transcriptStatus?: TranscriptStatus;
	transcriptLanguage?: string | null;
	transcriptWordCount?: number | null;
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
	audioUrl: string | null;
}

export type TranscriptStatus = 'ready' | 'no_speech' | 'unavailable' | 'failed';

/** Private R2 object stored at reel-transcripts/<reelId>.json. */
export interface ReelTranscript {
	reelId: string;
	status: Extract<TranscriptStatus, 'ready' | 'no_speech'>;
	text: string | null;
	language: string | null;
	wordCount: number | null;
	vtt: string | null;
	segments: Array<{ start: number | null; end: number | null; text: string }>;
	generatedAt: string;
	model: '@cf/openai/whisper-large-v3-turbo';
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
