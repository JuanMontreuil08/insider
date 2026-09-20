import type { InstagramReel } from './types';

const SYSTEM_PROMPT = `ROLE
You are the editorial judge for SF AI Pulse: a searchable catalog of Instagram
Reels about San Francisco technology and AI.

TASK
Read the delegated JSON batch. Keep only Reels that explicitly show or discuss
a real San Francisco technology, startup, AI, robotics, developer, founder,
venture, product-launch, or tech-culture trend.

For every Reel you keep, return only its input id exactly.

CONTEXT
- A candidate may have no Instagram location tag. Judge its relevance from the
  caption and metadata; do not reject it solely for missing location.
- A creator-tagged location is not proof that the video was recorded there.
- Use only the supplied caption and metadata. Do not infer missing facts.
- Reject tourism, restaurants, real estate, generic city footage, generic AI
  advice, unrelated lifestyle content, and any Reel whose SF-tech relevance is
  not explicit.
- When uncertain, reject the Reel.

OUTPUT FORMAT
Return valid JSON only: an array of approved Reel id strings. Do not use
Markdown, explanations, comments, extra keys, or code fences. Return [] when
nothing passes the bar.`;

export async function judgeReels(openaiKey: string, candidates: InstagramReel[]): Promise<string[]> {
	const response = await fetch('https://api.openai.com/v1/chat/completions', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${openaiKey}`,
		},
		body: JSON.stringify({
			model: 'gpt-4.1-mini',
			temperature: 0,
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{
					role: 'user',
					content: `Evaluate this batch for the SF AI Pulse searchable Reel catalog. A location tag is optional; decide from the caption and available metadata.\n\n${JSON.stringify(candidates, null, 2)}`,
				},
			],
		}),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`OpenAI API error ${response.status}: ${text}`);
	}

	const data = (await response.json()) as { choices: { message: { content: string } }[] };
	const raw = data.choices[0].message.content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
	return JSON.parse(raw) as string[];
}
