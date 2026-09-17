import { init } from '@flue/runtime';
import { start } from '@flue/runtime/node';
import { execSync } from 'node:child_process';
import db from './db.ts';
import {
	buildSceneWriterPrompt,
	type SceneCard,
	type SceneWriterOutput,
} from './prompts.ts';
import { SceneWriter } from './subagents/scene-writer.ts';

const D1_DB = 'insider-game';

/* ------------------------------------------------------------------ */
/*  Read cards from D1                                                */
/* ------------------------------------------------------------------ */

function queryD1(sql: string): string {
	const result = execSync(
		`npx wrangler d1 execute ${D1_DB} --remote --command "${sql.replace(/"/g, '\\"')}" --json`,
		{ encoding: 'utf-8', timeout: 30_000 },
	);
	return result;
}

function getCardsWithoutScenePrompt(): SceneCard[] {
	const raw = queryD1(
		'SELECT id, layer, title, fact, explanation FROM game_cards WHERE scene_prompt IS NULL ORDER BY layer, id',
	);
	const parsed = JSON.parse(raw) as Array<{ results: SceneCard[] }>;
	return parsed[0]?.results ?? [];
}

function updateScenePrompt(id: string, scenePrompt: string, negativePrompt: string): void {
	const esc = (s: string) => s.replace(/'/g, "''");
	queryD1(
		`UPDATE game_cards SET scene_prompt = '${esc(scenePrompt)}', negative_prompt = '${esc(negativePrompt)}' WHERE id = '${esc(id)}'`,
	);
}

/* ------------------------------------------------------------------ */
/*  Main pipeline                                                     */
/* ------------------------------------------------------------------ */

const cards = getCardsWithoutScenePrompt();
console.log(`Cards without scene_prompt: ${cards.length}`);

if (cards.length === 0) {
	console.log('\n✓ All cards already have scene prompts.');
	process.exit(0);
}

const flue = await start({ agents: [SceneWriter], db });

try {
	console.log('\n→ Running Scene Writer...');
	const agent = init(SceneWriter);
	const receipt = await agent.dispatch(buildSceneWriterPrompt(cards));
	const raw = (await agent.read(receipt)).text;
	const clean = raw.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
	const results = JSON.parse(clean) as SceneWriterOutput;

	if (!Array.isArray(results) || results.length !== cards.length) {
		throw new Error(`Scene Writer must return ${cards.length} results, got ${results.length}.`);
	}

	console.log(`  Generated: ${results.length} scene prompts\n`);

	// Write each scene_prompt back to D1
	for (const result of results) {
		if (!result.id || !result.scene_prompt || !result.negative_prompt) {
			throw new Error(`Invalid scene result for id=${result.id}: missing fields.`);
		}

		const card = cards.find((c) => c.id === result.id);
		if (!card) throw new Error(`Scene result id="${result.id}" does not match any input card.`);

		console.log(`  → Writing scene_prompt for ${result.id}`);
		updateScenePrompt(result.id, result.scene_prompt, result.negative_prompt);
	}

	console.log(
		JSON.stringify({ cards_processed: results.length, status: 'success' }, null, 2),
	);
} finally {
	await flue.stop();
}
