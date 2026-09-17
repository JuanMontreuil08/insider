'use agent';
import { useModel } from '@flue/runtime';

/**
 * An isolated Sol stage. Its dispatched message supplies the exact source page
 * and the full role/task/context/few-shot prompt.
 */
export function FactCurator() {
	useModel('openai/gpt-5.6-sol', { thinkingLevel: 'low' });
	return `You are Insider's fact curator. Read the complete delegated task and
return only the requested JSON. Select facts with a high bar for source
grounding, Silicon Valley relevance, learning value, and cinematic potential.
Do not generate explanations.`;
}
