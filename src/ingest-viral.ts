import { init } from '@flue/runtime';
import { start } from '@flue/runtime/node';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import db from './db.ts';
import {
	buildViralCuratorPrompt,
	buildViralEnricherPrompt,
	type ViralCuratorOutput,
	type ViralEnricherOutput,
} from './prompts.ts';
import {
	type ViralCandidate,
	type ViralRepresentation,
	validateViralCandidate,
	validateViralRepresentation,
} from './schemas.ts';
import { ViralCurator } from './subagents/viral-curator.ts';
import { ContextEnricher } from './subagents/context-enricher.ts';
import { fetchTikTokVideos, dedup, TIKTOK_DEFAULT_PARAMS } from './sources/tiktok.ts';

const OUTPUT_PATH = 'output/viral-cards.json';

/* ------------------------------------------------------------------ */
/*  Load existing cards for dedup                                     */
/* ------------------------------------------------------------------ */

async function loadExistingCards(): Promise<ViralRepresentation[]> {
	try {
		const raw = await readFile(OUTPUT_PATH, 'utf-8');
		return JSON.parse(raw) as ViralRepresentation[];
	} catch {
		return [];
	}
}

/* ------------------------------------------------------------------ */
/*  Main pipeline                                                     */
/* ------------------------------------------------------------------ */

const apiKey = process.env.SCRAPE_API_KEY;
if (!apiKey) throw new Error('SCRAPE_API_KEY is not set in .env');

const existingCards = await loadExistingCards();
const existingIds = new Set(existingCards.map((c) => c.aweme_id));
console.log(`Existing cards: ${existingCards.length} (${existingIds.size} unique IDs)`);

// 1. Fetch from TikTok API
console.log('\n→ Fetching TikTok videos...');
const allVideos = await fetchTikTokVideos(apiKey, TIKTOK_DEFAULT_PARAMS);
console.log(`  Fetched: ${allVideos.length} videos`);

// 2. Dedup
const newVideos = dedup(allVideos, existingIds);
console.log(`  New (after dedup): ${newVideos.length} videos`);

if (newVideos.length === 0) {
	console.log('\n✓ No new videos to process. Output unchanged.');
	process.exit(0);
}

// 3. Curator + Enricher pipeline
const flue = await start({ agents: [ViralCurator, ContextEnricher], db });
const newCards: ViralRepresentation[] = [];

try {
	// 3a. Curator: filter the batch
	console.log('\n→ Running viral curator...');
	const candidates = await runViralCurator(buildViralCuratorPrompt(newVideos));
	validateCandidates(candidates);
	console.log(`  Curator approved: ${candidates.length} / ${newVideos.length} videos`);

	if (candidates.length === 0) {
		console.log('\n✓ Curator rejected all videos. No new cards.');
		process.exit(0);
	}

	// 3b. Enricher: add explanations
	console.log('\n→ Running context enricher...');
	const enriched = await runViralEnricher(buildViralEnricherPrompt(candidates));
	validateEnrichedCards(enriched, candidates);
	newCards.push(...enriched);

	// 4. Merge and write
	const merged = [...existingCards, ...newCards];
	await mkdir('output', { recursive: true });
	await writeFile(OUTPUT_PATH, `${JSON.stringify(merged, null, 2)}\n`);

	console.log(
		JSON.stringify(
			{
				output: OUTPUT_PATH,
				existing: existingCards.length,
				new: newCards.length,
				total: merged.length,
			},
			null,
			2,
		),
	);
} finally {
	await flue.stop();
}

/* ------------------------------------------------------------------ */
/*  Agent runners                                                     */
/* ------------------------------------------------------------------ */

async function runViralCurator(prompt: string): Promise<ViralCuratorOutput> {
	const agent = init(ViralCurator);
	const receipt = await agent.dispatch(prompt);
	return parseJson<ViralCuratorOutput>((await agent.read(receipt)).text);
}

async function runViralEnricher(prompt: string): Promise<ViralEnricherOutput> {
	const agent = init(ContextEnricher);
	const receipt = await agent.dispatch(prompt);
	return parseJson<ViralEnricherOutput>((await agent.read(receipt)).text);
}

function parseJson<T>(text: string): T {
	const clean = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
	return JSON.parse(clean) as T;
}

/* ------------------------------------------------------------------ */
/*  Validation                                                        */
/* ------------------------------------------------------------------ */

function validateCandidates(candidates: ViralCandidate[]): void {
	if (!Array.isArray(candidates)) {
		throw new Error('Curator must return an array of viral candidates.');
	}

	for (const candidate of candidates) {
		const errors = validateViralCandidate(candidate);
		if (errors.length) throw new Error(`Invalid viral candidate: ${errors.join(', ')}.`);
	}
}

function validateEnrichedCards(cards: ViralRepresentation[], candidates: ViralCandidate[]): void {
	if (!Array.isArray(cards) || cards.length !== candidates.length) {
		throw new Error('Enricher must return one card for every approved candidate.');
	}

	for (let i = 0; i < cards.length; i += 1) {
		const card = cards[i];
		const candidate = candidates[i];
		const errors = validateViralRepresentation(card);
		if (
			card.aweme_id !== candidate.aweme_id ||
			card.category !== candidate.category ||
			card.title !== candidate.title ||
			card.source !== candidate.source ||
			card.fact !== candidate.fact
		) {
			errors.push('approved candidate fields must remain unchanged');
		}
		if (errors.length) throw new Error(`Invalid enriched viral card: ${errors.join(', ')}.`);
	}
}
