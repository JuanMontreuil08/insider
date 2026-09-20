import { init } from '@flue/runtime';
import { start } from '@flue/runtime/node';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { SfAiJudge } from './agents/sf-ai-judge.ts';
import { DATE_POSTED, fetchSanFranciscoAiReels } from './instagram.ts';
import type { InstagramReel, PinCollection } from './types.ts';

const OUTPUT_PATH = 'public/data/sf-ai-pins.json';
const PIPELINE_VERSION = 2;
const apiKey = process.env.SCRAPE_API_KEY;
if (!apiKey) throw new Error('SCRAPE_API_KEY is not set.');

const today = new Date().toISOString().slice(0, 10);
const previous = await readExistingPins();
if (previous?.datePosted === DATE_POSTED && previous.lastSearchedOn === today && previous.pipelineVersion === PIPELINE_VERSION) {
	console.log(`Instagram search already completed on ${today}; no API request made.`);
} else {
	const candidates = await fetchSanFranciscoAiReels(apiKey);
	const knownIds = new Set([...(previous?.seenReelIds ?? []), ...(previous?.pins.map((pin) => pin.id) ?? [])]);
	const newCandidates = candidates.filter((candidate) => !knownIds.has(candidate.id));
	console.log(`SF AI candidates: ${candidates.length}; new IDs: ${newCandidates.length}`);

	let newPins: InstagramReel[] = [];
	if (newCandidates.length) {
		const flue = await start({ agents: [SfAiJudge] });
		try {
			const judge = init(SfAiJudge, { id: `sf-ai-week-${today}` });
			const receipt = await judge.dispatch(buildJudgePrompt(newCandidates));
			const approved = parseJson<string[]>((await judge.read(receipt)).text);
			newPins = mergeApproved(newCandidates, approved);
		} finally {
			await flue.stop();
		}
	}
	const pins = [...(previous?.pins ?? []), ...newPins];
	const output: PinCollection = {
		generatedAt: new Date().toISOString(),
		query: 'San Francisco AI',
		datePosted: DATE_POSTED,
		lastSearchedOn: today,
		pipelineVersion: PIPELINE_VERSION,
		seenReelIds: [...new Set([...knownIds, ...candidates.map((candidate) => candidate.id)])],
		candidates: candidates.length,
		pins,
	};

	await mkdir('public/data', { recursive: true });
	await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
	console.log(JSON.stringify({ output: OUTPUT_PATH, candidates: candidates.length, newCandidates: newCandidates.length, added: newPins.length, totalPins: pins.length }, null, 2));
}

async function readExistingPins(): Promise<PinCollection | null> {
	try {
		const data = JSON.parse(await readFile(OUTPUT_PATH, 'utf8')) as PinCollection;
		if (!Array.isArray(data.pins)) throw new Error('Existing pin file is malformed.');
		return data;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

function buildJudgePrompt(candidates: InstagramReel[]): string {
	return `Evaluate this batch for the SF AI Pulse searchable Reel catalog. A
location tag is optional; decide from the caption and available metadata.\n\n${JSON.stringify(candidates, null, 2)}`;
}

function parseJson<T>(text: string): T {
	return JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')) as T;
}

function mergeApproved(candidates: InstagramReel[], approved: string[]): InstagramReel[] {
	if (!Array.isArray(approved)) throw new Error('Judge must return an array.');
	const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	const seen = new Set<string>();
	return approved.map((id) => {
		const candidate = byId.get(id);
		if (typeof id !== 'string' || !candidate || seen.has(id)) {
			throw new Error(`Judge returned an invalid result for id=${id}.`);
		}
		seen.add(id);
		return candidate;
	});
}
