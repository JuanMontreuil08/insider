import { init } from '@flue/runtime';
import { start } from '@flue/runtime/node';
import { mkdir, writeFile } from 'node:fs/promises';
import { SfAiJudge } from './agents/sf-ai-judge.ts';
import { fetchSanFranciscoAiReels } from './instagram.ts';
import type { InstagramReel, JudgedReel, PinCollection } from './types.ts';

const OUTPUT_PATH = 'public/data/sf-ai-pins.json';
const apiKey = process.env.SCRAPE_API_KEY;
if (!apiKey) throw new Error('SCRAPE_API_KEY is not set.');

const candidates = await fetchSanFranciscoAiReels(apiKey);
console.log(`Native-location SF candidates: ${candidates.length}`);

const flue = await start({ agents: [SfAiJudge] });
try {
	const judge = init(SfAiJudge, { id: `sf-ai-${new Date().toISOString().slice(0, 10)}` });
	const receipt = await judge.dispatch(buildJudgePrompt(candidates));
	const approved = parseJson<JudgedReel[]>((await judge.read(receipt)).text);
	const pins = mergeApproved(candidates, approved);
	const output: PinCollection = {
		generatedAt: new Date().toISOString(),
		query: 'San Francisco AI',
		datePosted: 'last-month',
		candidates: candidates.length,
		pins,
	};

	await mkdir('public/data', { recursive: true });
	await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
	console.log(JSON.stringify({ output: OUTPUT_PATH, candidates: candidates.length, approved: pins.length }, null, 2));
} finally {
	await flue.stop();
}

function buildJudgePrompt(candidates: InstagramReel[]): string {
	return `Evaluate this batch. These are the only Reels eligible for the map; each
already has creator-tagged native coordinates inside San Francisco.\n\n${JSON.stringify(candidates, null, 2)}`;
}

function parseJson<T>(text: string): T {
	return JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')) as T;
}

function mergeApproved(candidates: InstagramReel[], approved: JudgedReel[]): Array<InstagramReel & JudgedReel> {
	if (!Array.isArray(approved)) throw new Error('Judge must return an array.');
	const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
	const seen = new Set<string>();
	return approved.map((judgement) => {
		const candidate = byId.get(judgement.id);
		if (!candidate || seen.has(judgement.id) || !judgement.title?.trim() || !judgement.description?.trim()) {
			throw new Error(`Judge returned an invalid result for id=${judgement.id}.`);
		}
		seen.add(judgement.id);
		return { ...candidate, title: judgement.title.trim(), description: judgement.description.trim() };
	});
}
