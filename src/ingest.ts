import { init } from '@flue/runtime';
import { start } from '@flue/runtime/node';
import { mkdir, writeFile } from 'node:fs/promises';
import db from './db.ts';
import {
	buildContextEnricherPrompt,
	buildFactCuratorPrompt,
	type ContextEnricherOutput,
	type FactCuratorOutput,
} from './prompts.ts';
import {
	MAX_FACTS_PER_SOURCE,
	type CandidateFact,
	type HistoricalRepresentation,
	validateCandidateFact,
	validateHistoricalRepresentation,
} from './schemas.ts';
import { ContextEnricher } from './subagents/context-enricher.ts';
import { FactCurator } from './subagents/fact-curator.ts';
import { HISTORICAL_SOURCES } from './sources/historical.ts';
import { retrieveSourcePage } from './tools/retrieve-source.ts';

const requestedSource = process.argv[2];
const sources = requestedSource ? [requestedSource] : HISTORICAL_SOURCES;
const cards: HistoricalRepresentation[] = [];
const failures: { source: string; error: string }[] = [];
const flue = await start({ agents: [FactCurator, ContextEnricher], db });

try {
	for (const source of sources) {
		try {
			const sourcePage = await retrieveSourcePage(source);
			const facts = await runFactCurator(buildFactCuratorPrompt(sourcePage));
			validateFacts(facts, sourcePage.source);

			if (facts.length > 0) {
				const sourceCards = await runContextEnricher(buildContextEnricherPrompt(sourcePage, facts));
				validateCards(sourceCards, facts);
				cards.push(...sourceCards);
			}
		} catch (error) {
			failures.push({
				source,
				error: error instanceof Error ? error.message : 'Unknown ingestion error.',
			});
		}
	}

	await mkdir('output', { recursive: true });
	await writeFile('output/historical-cards.json', `${JSON.stringify(cards, null, 2)}\n`);
	console.log(JSON.stringify({ output: 'output/historical-cards.json', cards: cards.length, failures }, null, 2));
} finally {
	await flue.stop();
}

async function runFactCurator(prompt: string): Promise<FactCuratorOutput> {
	const agent = init(FactCurator);
	const receipt = await agent.dispatch(prompt);
	return parseJson<FactCuratorOutput>((await agent.read(receipt)).text);
}

async function runContextEnricher(prompt: string): Promise<ContextEnricherOutput> {
	const agent = init(ContextEnricher);
	const receipt = await agent.dispatch(prompt);
	return parseJson<ContextEnricherOutput>((await agent.read(receipt)).text);
}

function parseJson<T>(text: string): T {
	const clean = text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '');
	return JSON.parse(clean) as T;
}

function validateFacts(facts: CandidateFact[], source: string): void {
	if (!Array.isArray(facts) || facts.length > MAX_FACTS_PER_SOURCE) {
		throw new Error(`Curator must return an array of at most ${MAX_FACTS_PER_SOURCE} facts.`);
	}

	for (const fact of facts) {
		const errors = validateCandidateFact(fact);
		if (fact.source !== source) errors.push('source must be the retrieved source page');
		if (errors.length) throw new Error(`Invalid curated fact: ${errors.join(', ')}.`);
	}
}

function validateCards(cards: HistoricalRepresentation[], facts: CandidateFact[]): void {
	if (!Array.isArray(cards) || cards.length !== facts.length) {
		throw new Error('Enricher must return one card for every approved fact.');
	}

	for (let index = 0; index < cards.length; index += 1) {
		const card = cards[index];
		const fact = facts[index];
		const errors = validateHistoricalRepresentation(card);
		if (
			card.category !== fact.category ||
			card.title !== fact.title ||
			card.source !== fact.source ||
			card.fact !== fact.fact
		) {
			errors.push('approved fact fields must remain unchanged');
		}
		if (errors.length) throw new Error(`Invalid enriched card: ${errors.join(', ')}.`);
	}
}
