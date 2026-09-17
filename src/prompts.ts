import {
	HISTORICAL_CATEGORIES,
	MAX_FACTS_PER_SOURCE,
	VIRAL_CATEGORIES,
	type CandidateFact,
	type HistoricalRepresentation,
	type SourcePage,
	type TikTokVideo,
	type ViralCandidate,
	type ViralRepresentation,
} from './schemas.ts';

const categoryList = HISTORICAL_CATEGORIES.join(', ');

/**
 * Builds the first model call. It combines extraction and curation so the MVP
 * spends one strong-model call per source page before enrichment.
 */
export function buildFactCuratorPrompt(sourcePage: SourcePage): string {
	return `
ROLE
You are the historical curator for Insider, a cinematic trivia game about San
Francisco and Silicon Valley culture.

TASK
Read the supplied source page. Select at most ${MAX_FACTS_PER_SOURCE} historical
facts that deserve to become game cards. Return only facts that pass every rule.
Do not write explanations yet.

CONTEXT
The audience is young tech enthusiasts at a hackathon. They want to learn while
having fun. A strong card reveals a memorable Silicon Valley story with a clear
connection to a founder, product, breakthrough, infrastructure, community, or
cultural meme. The card must be visually playable as a future cinematic scene.

ALLOWED CATEGORIES
${categoryList}

NON-NEGOTIABLE RULES
1. Use only facts directly supported by this exact source page.
2. The source field must be exactly: ${sourcePage.source}
3. Reject generic institutional history, vague claims, and facts without a
   meaningful San Francisco, Bay Area, or Silicon Valley connection.
4. Prefer surprising origins, conflicts, decisions, objects, places, or moments
   that a player can picture.
5. Never infer details missing from the page. If no card meets the standard,
   return an empty array.
6. A fact is one concise, verifiable historical statement. Do not add an
   explanation, score, commentary, or Markdown.

FEW-SHOT EXAMPLE
Source page says: "In 1957, eight engineers left Shockley Semiconductor
Laboratory and later founded Fairchild Semiconductor."

Good output:
[
  {
    "category": "Breakthroughs",
    "title": "The Traitorous Eight leave Shockley",
    "source": "https://example.org/silicon-genesis",
    "fact": "In 1957, eight engineers left Shockley Semiconductor Laboratory, a split that led to Fairchild Semiconductor."
  }
]

Bad output: do not return a card such as "Stanford preserves technology
archives" because it is generic and not a playable cultural moment.

EXPECTED OUTPUT FORMAT
Return valid JSON only: an array of zero to ${MAX_FACTS_PER_SOURCE} objects.
Every object must have exactly these string fields:
category, title, source, fact.

SOURCE PAGE
URL: ${sourcePage.source}
CONTENT:
${sourcePage.content}
`.trim();
}

/**
 * Builds the second, cheaper model call. It is invoked only for facts the
 * curator accepted, and cannot change the approved card fields.
 */
export function buildContextEnricherPrompt(
	sourcePage: SourcePage,
	acceptedFacts: CandidateFact[],
): string {
	return `
ROLE
You are the historical context writer for Insider, a cinematic trivia game about
San Francisco and Silicon Valley culture.

TASK
Write a useful, historically grounded explanation for every approved fact.
Keep each approved category, title, source, and fact exactly unchanged.

CONTEXT
These explanations will teach a young tech enthusiast why the reference matters
and later help a scene-generation agent understand the historical setting. They
are context, not video prompts. Include only detail supported by the supplied
source page.

WRITING RULES
1. Write one compact paragraph per card, roughly 90–160 words.
2. Explain the time/place, people or organizations, what happened, and why it
   mattered to Silicon Valley culture or technology.
3. Include concrete visual atmosphere only when supported by the page—for
   example a garage, lab, hardware, campus, newsroom, train, or neighborhood.
4. Do not invent dialogue, physical details, motives, or later outcomes.
5. Never change the approved fact, title, category, or source URL.

FEW-SHOT EXAMPLE
Approved fact:
{
  "category": "Breakthroughs",
  "title": "The Traitorous Eight leave Shockley",
  "source": "https://example.org/silicon-genesis",
  "fact": "In 1957, eight engineers left Shockley Semiconductor Laboratory, a split that led to Fairchild Semiconductor."
}

Good explanation:
"In 1957, a group of eight engineers broke from William Shockley's laboratory
at a time when the Santa Clara Valley was becoming a center for semiconductor
research. Their move led to Fairchild Semiconductor, a company associated with
the early culture of technical spinouts that later defined Silicon Valley. The
moment turns a management split into a memorable origin story: engineers,
transistor-era research, and a suburban California region beginning to transform
into a technology hub."

EXPECTED OUTPUT FORMAT
Return valid JSON only: an array with one object for every approved fact.
Every object must have exactly these string fields:
category, title, source, fact, explanation.

APPROVED FACTS
${JSON.stringify(acceptedFacts, null, 2)}

SOURCE PAGE
URL: ${sourcePage.source}
CONTENT:
${sourcePage.content}
`.trim();
}

export type FactCuratorOutput = CandidateFact[];
export type ContextEnricherOutput = HistoricalRepresentation[];

/* ------------------------------------------------------------------ */
/*  Viral (TikTok) prompts                                            */
/* ------------------------------------------------------------------ */

const viralCategoryList = VIRAL_CATEGORIES.join(', ');

/**
 * Builds the curator prompt for a batch of TikTok videos.
 * The curator filters noise and selects culturally relevant videos.
 */
export function buildViralCuratorPrompt(videos: TikTokVideo[]): string {
	return `
ROLE
You are the viral content curator for Insider, a cinematic trivia game about San
Francisco and Silicon Valley culture.

TASK
Review the batch of TikTok videos below. Select only the ones that represent a
real, recognizable cultural reference from the SF/SV tech ecosystem. Return a
curated array of candidates. Reject noise aggressively — expect ~70% to be
irrelevant.

CONTEXT
The audience is young tech enthusiasts at a hackathon. A strong card captures a
viral moment that reveals something about SF/SV culture: a robot on the street,
an AI meme, a founder moment, a neighborhood vibe, a product launch, a cultural
clash. The reference must be visually representable as a cinematic scene.

ALLOWED CATEGORIES
${viralCategoryList}

NON-NEGOTIABLE RULES
1. Only select videos whose description clearly references a specific SF/SV
   cultural moment, person, product, place, trend, or meme.
2. Reject: tourist vlogs, generic AI opinions, sports content, non-English
   content with no clear reference, random SF footage with no cultural signal.
3. The aweme_id and source fields must be preserved exactly from the input.
4. The source field must be: https://www.tiktok.com/@{author}/video/{aweme_id}
5. Write a concise fact (one sentence) describing the cultural reference shown
   in the video. Base it only on the video description and engagement context.
6. Do not write explanations. Do not add Markdown or commentary.
7. If no video meets the standard, return an empty array.

FEW-SHOT EXAMPLE
Input video:
{
  "aweme_id": "7676624898005011742",
  "desc": "Tau robotics cleaners in San Francisco #techtok #sanfrancisco",
  "author": "techguy",
  "play_count": 9974328,
  "digg_count": 563026
}

Good output:
[
  {
    "aweme_id": "7676624898005011742",
    "category": "Products",
    "title": "Tau Robotics street cleaners roam SF",
    "source": "https://www.tiktok.com/@techguy/video/7676624898005011742",
    "fact": "Tau Robotics autonomous cleaning robots were spotted operating on San Francisco streets, going viral with nearly 10 million views."
  }
]

Bad output: do not return a video like "Beautiful sunset in SF #travel" because
it has no tech cultural reference.

EXPECTED OUTPUT FORMAT
Return valid JSON only: an array of objects. Every object must have exactly
these string fields: aweme_id, category, title, source, fact.

TIKTOK VIDEOS
${JSON.stringify(videos, null, 2)}
`.trim();
}

/**
 * Builds the enricher prompt for viral candidates.
 * The explanation should help a Kling AI scene-generation agent understand
 * the cultural context and visual setting of the reference.
 */
export function buildViralEnricherPrompt(candidates: ViralCandidate[]): string {
	return `
ROLE
You are the viral context writer for Insider, a cinematic trivia game about San
Francisco and Silicon Valley culture.

TASK
Write a useful explanation for every approved viral candidate. The explanation
must help both:
1. A player understand why this reference matters in SF/SV culture.
2. A scene-generation agent (Kling AI) understand the visual setting, mood, and
   cultural atmosphere to create a cinematic scene.

Keep each approved aweme_id, category, title, source, and fact exactly unchanged.

WRITING RULES
1. Write one compact paragraph per card, roughly 90–160 words.
2. Explain what the reference is, why it went viral, and what it says about
   current SF/SV culture or the tech ecosystem.
3. Include concrete visual details that would help generate a cinematic scene:
   describe the setting (street, office, conference, neighborhood), objects
   (robots, screens, devices), atmosphere (fog, neon, crowds), and action.
4. Ground the explanation in the real cultural moment — do not invent details
   that are not implied by the video description and fact.
5. Never change the approved aweme_id, fact, title, category, or source URL.

FEW-SHOT EXAMPLE
Approved candidate:
{
  "aweme_id": "7676624898005011742",
  "category": "Products",
  "title": "Tau Robotics street cleaners roam SF",
  "source": "https://www.tiktok.com/@techguy/video/7676624898005011742",
  "fact": "Tau Robotics autonomous cleaning robots were spotted operating on San Francisco streets, going viral with nearly 10 million views."
}

Good explanation:
"In mid-2026, Tau Robotics deployed autonomous street-cleaning robots across San
Francisco sidewalks, and TikTok users captured them navigating around pedestrians
in neighborhoods like SoMa and the Mission. The videos — showing compact white
machines humming past cafes and parked scooters — accumulated nearly 10 million
plays, turning a municipal experiment into a cultural moment. The scene captures
SF's current identity: a city where robots share the sidewalk with tech workers,
tourists, and unhoused residents. For a cinematic scene, picture a foggy San
Francisco morning, a compact robot gliding past a coffee shop while onlookers
film with their phones."

EXPECTED OUTPUT FORMAT
Return valid JSON only: an array with one object for every approved candidate.
Every object must have exactly these string fields:
aweme_id, category, title, source, fact, explanation.

APPROVED CANDIDATES
${JSON.stringify(candidates, null, 2)}
`.trim();
}

export type ViralCuratorOutput = ViralCandidate[];
export type ViralEnricherOutput = ViralRepresentation[];
