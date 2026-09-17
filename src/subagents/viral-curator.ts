'use agent';
import { useModel } from '@flue/runtime';

/**
 * An isolated Sol stage for viral TikTok content. Its dispatched message
 * supplies the batch of TikTok videos and the full role/task/context prompt.
 */
export function ViralCurator() {
	useModel('openai/gpt-5.6-sol', { thinkingLevel: 'low' });
	return `You are Insider's viral content curator. Read the complete delegated
task and return only the requested JSON. Filter TikTok videos with a high bar
for San Francisco / Silicon Valley cultural relevance, visual cinematic
potential, and engagement signals. Reject noise aggressively. Do not generate
explanations.`;
}
