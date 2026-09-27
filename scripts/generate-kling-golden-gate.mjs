import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDir = path.resolve('output/kling-golden-gate-reference-angle');
const referencePath = process.argv[2];
const apiBase = 'https://api-singapore.klingai.com/v1/images/omni-image';
const models = ['kling-v3-omni', 'kling-image-o1'];
const prompt = `Transform <<image_1>> while preserving its exact panoramic point of view and composition: a high viewpoint from the Marin Headlands, looking southeast across the Golden Gate Bridge; the near north tower is very large in the center-left foreground, the bridge deck runs diagonally toward the smaller south tower at the far right, with San Francisco across the bay in the distance. Preserve the bridge's imposing scale, dramatic diagonal suspension cables, bay, hills, sky, and depth. Render the scene as a refined graphite pencil drawing on warm off-white paper: architectural-sketch precision, delicate cross-hatching, soft atmospheric shading, subtle paper grain, restrained editorial elegance. Fade the left and lower outer edges gently into warm off-white mist so the artwork can blend naturally into a website background gradient. Retain only a subtle muted rust-red pencil accent on the bridge. No text, people, logos, frame, photographic rendering, watercolor, saturated color, or dark background.`;

if (!process.env.KLING_API_KEY) throw new Error('KLING_API_KEY is not configured.');

await mkdir(outputDir, { recursive: true });

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.code) throw new Error(`${response.status} ${data.message || 'Kling request failed'}`);
  return data.data;
}

const headers = {
  Authorization: `Bearer ${process.env.KLING_API_KEY}`,
  'Content-Type': 'application/json',
};

if (process.argv[2] === '--poll') {
  const { tasks } = JSON.parse(await readFile(path.join(outputDir, 'tasks.json'), 'utf8'));
  const completed = [];
  for (const task of tasks) {
    const result = await request(`${apiBase}/${task.taskId}`, { headers });
    if (result.task_status === 'failed') throw new Error(`${task.modelName}: ${result.task_status_msg || 'generation failed'}`);
    if (result.task_status !== 'succeed') {
      completed.push({ ...task, status: result.task_status });
      continue;
    }
    const images = result.task_result?.images || [];
    for (const image of images) {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`Could not download ${task.modelName} result ${image.index}.`);
      await writeFile(path.join(outputDir, `${task.modelName}-${image.index + 1}.png`), Buffer.from(await response.arrayBuffer()));
    }
    completed.push({ ...task, status: 'succeed', images: images.length });
  }
  console.log(JSON.stringify(completed));
  process.exit();
}

if (!referencePath) throw new Error('Pass the PNG or JPEG reference-image path as the first argument.');

const reference = (await readFile(referencePath)).toString('base64');
const tasks = [];
for (const modelName of models) {
  const task = await request(apiBase, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model_name: modelName,
      prompt,
      image_list: [{ image: reference }],
      resolution: '2k',
      n: 2,
      aspect_ratio: '16:9',
      watermark_info: { enabled: false },
      external_task_id: `insider-golden-gate-${modelName}-${Date.now()}`,
    }),
  });
  tasks.push({ modelName, taskId: task.task_id });
}

await writeFile(path.join(outputDir, 'tasks.json'), JSON.stringify({ prompt, tasks }, null, 2));
console.log(JSON.stringify(tasks));
