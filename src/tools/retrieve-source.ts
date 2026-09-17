import type { SourcePage } from '../schemas.ts';

const STANFORD_HOST_SUFFIX = '.stanford.edu';
const COMPUTER_HISTORY_MUSEUM_HOST_SUFFIX = '.computerhistory.org';
const CALTRAIN_HOST_SUFFIX = '.caltrain.com';
const SAN_FRANCISCO_PUBLIC_LIBRARY_HOST_SUFFIX = '.sfpl.org';
const PAUL_GRAHAM_HOST_SUFFIX = '.paulgraham.com';

/** Fetches one Stanford page and returns its final URL plus readable text. */
export async function retrieveSourcePage(source: string): Promise<SourcePage> {
	const requestedUrl = requireAllowedSourceUrl(source);
	const response = await fetch(requestedUrl, {
		headers: { accept: 'text/html', 'user-agent': 'InsiderHistoricalResearch/0.1' },
		signal: AbortSignal.timeout(15_000),
	});

	if (!response.ok) throw new Error(`Source page returned HTTP ${response.status}.`);
	if (!response.headers.get('content-type')?.includes('text/html')) {
		throw new Error('Source page must be HTML.');
	}

	const content = htmlToText(await response.text());
	if (content.length < 400) throw new Error('Source page has too little readable text.');

	return { source: requireAllowedSourceUrl(response.url), content };
}

function requireAllowedSourceUrl(value: string): string {
	const url = new URL(value);
	const host = url.hostname.toLowerCase();
	const isStanford = host === 'stanford.edu' || host.endsWith(STANFORD_HOST_SUFFIX);
	const isComputerHistoryMuseum =
		host === 'computerhistory.org' || host.endsWith(COMPUTER_HISTORY_MUSEUM_HOST_SUFFIX);
	const isCaltrain = host === 'caltrain.com' || host.endsWith(CALTRAIN_HOST_SUFFIX);
	const isSanFranciscoPublicLibrary =
		host === 'sfpl.org' || host.endsWith(SAN_FRANCISCO_PUBLIC_LIBRARY_HOST_SUFFIX);
	const isPaulGraham = host === 'paulgraham.com' || host.endsWith(PAUL_GRAHAM_HOST_SUFFIX);

	if (
		url.protocol !== 'https:' ||
		(!isStanford && !isComputerHistoryMuseum && !isCaltrain && !isSanFranciscoPublicLibrary && !isPaulGraham)
	) {
		throw new Error('Use an HTTPS source page from the curated historical-source institutions.');
	}

	return url.toString();
}

function htmlToText(html: string): string {
	const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html;

	return main
		.replace(/<(script|style|nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<\/(p|div|li|h[1-6]|section)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.split('\n')
		.map((line) => line.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n');
}
