import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const KLING_API_KEY = process.env.KLING_API_KEY!;
const BASE_URL = 'https://api.klingai.com/v1';
const POLL_INTERVAL_MS = 10_000;
const D1_DB = 'insider-game';

/* ------------------------------------------------------------------ */
/*  Read card from D1                                                 */
/* ------------------------------------------------------------------ */

interface MediaCard {
	id: string;
	scene_prompt: string;
	negative_prompt: string;
}

function queryD1(sql: string): string {
	const result = execSync(
		`npx wrangler d1 execute ${D1_DB} --remote --command "${sql.replace(/"/g, '\\"')}" --json`,
		{ encoding: 'utf-8', timeout: 30_000 },
	);
	return result;
}

function getCard(id: string): MediaCard {
	const raw = queryD1(
		`SELECT id, scene_prompt, negative_prompt FROM game_cards WHERE id = '${id}'`,
	);
	const parsed = JSON.parse(raw) as Array<{ results: MediaCard[] }>;
	const card = parsed[0]?.results?.[0];
	if (!card) throw new Error(`Card "${id}" not found in D1`);
	if (!card.scene_prompt) throw new Error(`Card "${id}" has no scene_prompt yet`);
	return card;
}

/* ------------------------------------------------------------------ */
/*  Kling API helpers                                                 */
/* ------------------------------------------------------------------ */

async function klingPost(path: string, body: Record<string, unknown>) {
	const res = await fetch(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${KLING_API_KEY}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	});
	const json = (await res.json()) as any;
	if (json.code !== 0) throw new Error(`Kling POST ${path} failed: ${JSON.stringify(json)}`);
	return json.data;
}

async function klingPoll(path: string): Promise<any> {
	while (true) {
		const res = await fetch(`${BASE_URL}${path}`, {
			headers: { Authorization: `Bearer ${KLING_API_KEY}` },
		});
		const json = (await res.json()) as any;
		if (json.code !== 0) throw new Error(`Kling GET ${path} failed: ${JSON.stringify(json)}`);

		const status = json.data.task_status;
		if (status === 'succeed') return json.data;
		if (status === 'failed') throw new Error(`Task failed: ${json.data.task_status_msg}`);

		console.log(`  status: ${status}, waiting ${POLL_INTERVAL_MS / 1000}s...`);
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
	}
}

async function downloadFile(url: string, dest: string) {
	const res = await fetch(url);
	const buffer = Buffer.from(await res.arrayBuffer());
	writeFileSync(dest, buffer);
}

/* ------------------------------------------------------------------ */
/*  Pipeline                                                          */
/* ------------------------------------------------------------------ */

const cardId = process.argv[2] ?? 'viral-7679590597857955102';

console.log(`\n→ Reading card "${cardId}" from D1...`);
const card = getCard(cardId);
console.log(`  ✓ Found: scene_prompt (${card.scene_prompt.length} chars)`);

console.log(`\n→ Step 1: Generating image...`);

const imgTask = await klingPost('/images/generations', {
	model_name: 'kling-v3',
	prompt: card.scene_prompt,
	n: 1,
	aspect_ratio: '16:9',
});

console.log(`  task_id: ${imgTask.task_id}`);
const imgResult = await klingPoll(`/images/generations/${imgTask.task_id}`);
const imageUrl = imgResult.task_result.images[0].url;

const imagePath = join('output', 'images', `${card.id}.png`);
await downloadFile(imageUrl, imagePath);
console.log(`  ✓ Image saved: ${imagePath}`);

console.log(`\n→ Step 2: Generating video from image...`);

const vidTask = await klingPost('/videos/image2video', {
	model_name: 'kling-v3',
	image: imageUrl,
	prompt: card.scene_prompt,
	negative_prompt: card.negative_prompt,
	duration: '5',
	mode: 'std',
	cfg_scale: 0.5,
});

console.log(`  task_id: ${vidTask.task_id}`);
const vidResult = await klingPoll(`/videos/image2video/${vidTask.task_id}`);
const videoUrl = vidResult.task_result.videos[0].url;

const videoPath = join('output', 'videos', `${card.id}.mp4`);
await downloadFile(videoUrl, videoPath);
console.log(`  ✓ Video saved: ${videoPath}`);

console.log('\n✓ Done!');
