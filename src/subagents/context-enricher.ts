'use agent';
import { useModel } from '@flue/runtime';

/**
 * An isolated Luna stage. Its dispatched message contains only facts already
 * accepted by the Sol curator and the source page that supports them.
 */
export function ContextEnricher() {
	useModel('openai/gpt-5.6-luna', { thinkingLevel: 'off' });
	return `You are Insider's historical context writer. Read the complete
delegated task and return only the requested JSON. Write useful, vivid context
from the supplied source page, but never change an approved fact, category,
title, or source URL.`;
}
