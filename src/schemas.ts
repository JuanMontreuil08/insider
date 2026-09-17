/** Values stored in the final D1 game-card table. */
export const HISTORICAL_CATEGORIES = [
	'Founder',
	'Products',
	'Breakthroughs',
	'Infrastructure',
	'Communities',
	'Memes',
] as const;

export type HistoricalCategory = (typeof HISTORICAL_CATEGORIES)[number];

export const MAX_FACTS_PER_SOURCE = 1;

/** One exact source page after retrieval and text extraction. */
export interface SourcePage {
	source: string;
	content: string;
}

/** A factual candidate produced before enrichment. It deliberately has no explanation. */
export interface CandidateFact {
	category: HistoricalCategory;
	title: string;
	source: string;
	fact: string;
}

/** The only record shape persisted for the historical game layer. */
export interface HistoricalRepresentation extends CandidateFact {
	explanation: string;
}

export function isHistoricalCategory(value: string): value is HistoricalCategory {
	return (HISTORICAL_CATEGORIES as readonly string[]).includes(value);
}

export function validateSourceUrl(value: string): string[] {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:'
			? []
			: ['source must use http or https'];
	} catch {
		return ['source must be a valid URL'];
	}
}

export function validateCandidateFact(value: CandidateFact): string[] {
	const errors = validateSourceUrl(value.source);

	if (!isHistoricalCategory(value.category)) errors.push('category is not supported');
	if (!value.title.trim()) errors.push('title is required');
	if (!value.fact.trim()) errors.push('fact is required');

	return errors;
}

export function validateHistoricalRepresentation(value: HistoricalRepresentation): string[] {
	const errors = validateCandidateFact(value);
	if (!value.explanation.trim()) errors.push('explanation is required');
	return errors;
}

/* ------------------------------------------------------------------ */
/*  Viral (TikTok) layer                                              */
/* ------------------------------------------------------------------ */

export const VIRAL_CATEGORIES = [
	'Founder',
	'Products',
	'Breakthroughs',
	'Infrastructure',
	'Communities',
	'Memes',
] as const;

export type ViralCategory = (typeof VIRAL_CATEGORIES)[number];

/** Compact representation of one TikTok video returned by the API. */
export interface TikTokVideo {
	aweme_id: string;
	desc: string;
	author: string;
	play_count: number;
	digg_count: number;
	share_count: number;
	comment_count: number;
}

/** A viral candidate produced by the curator before enrichment. */
export interface ViralCandidate {
	aweme_id: string;
	category: ViralCategory;
	title: string;
	source: string;
	fact: string;
}

/** The record shape persisted for the viral game layer. */
export interface ViralRepresentation extends ViralCandidate {
	explanation: string;
}

export function isViralCategory(value: string): value is ViralCategory {
	return (VIRAL_CATEGORIES as readonly string[]).includes(value);
}

export function validateViralCandidate(value: ViralCandidate): string[] {
	const errors = validateSourceUrl(value.source);

	if (!isViralCategory(value.category)) errors.push('category is not supported');
	if (!value.aweme_id.trim()) errors.push('aweme_id is required');
	if (!value.title.trim()) errors.push('title is required');
	if (!value.fact.trim()) errors.push('fact is required');

	return errors;
}

export function validateViralRepresentation(value: ViralRepresentation): string[] {
	const errors = validateViralCandidate(value);
	if (!value.explanation.trim()) errors.push('explanation is required');
	return errors;
}
