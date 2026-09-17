# AGENTS.md

## Project context

This project is a single-player web game about the culture and vibes of San Francisco and Silicon Valley. Players learn to recognize recent references from the tech ecosystem through cinematic scenes generated with Kling AI models.

The project is being prepared for [Hack Alcatraz with Cloudflare and Kling AI](https://partiful.com/e/eCaHdWFnG2wup28XcOHi). The event favors fun, simple hacks that can be demonstrated in 1–2 minutes. It is not a traditional startup pitch competition.

## Core experience

1. The player receives a cinematic scene.
2. The scene represents a person, company, product, place, behavior, or trend related to San Francisco or Silicon Valley.
3. The player chooses what the scene references from multiple options.
4. A correct answer awards points.
5. An incorrect answer reveals the correct answer and provides a short explanation.
6. The player continues with new scenes indefinitely.

Difficulty should progress from relatively recognizable references to increasingly niche and insider references. Categories should be mixed to keep the experience simple and surprising.

## Tone and learning

- The tone should be fun, conversational, and memorable.
- The game should teach the context behind each reference, not only test recall.
- Explanations should be short and understandable to someone unfamiliar with the local tech scene.
- References may be recent and change over time; content should be updateable later.

## Current scope

Included:

- Single-player web game.
- Cinematic scenes generated with Kling AI.
- Multiple-choice questions.
- Scoring.
- Educational feedback after incorrect answers.
- Continuous gameplay with no fixed number of scenes.
- Mixed references involving people, companies, products, places, and trends.

Out of scope for now:

- Multiplayer, rankings, or competition between users.
- A traditional startup pitch deck or business-product framing.
- Architecture, technical stack, data model, and content-update strategy.
- A fully defined visual identity.
- Unapproved features or unnecessary complexity.

## Discussed reference examples

- **Corgi Cafe:** A scene of corgis working late at a cafe. It represents the recent San Francisco culture around builders, founders, and AI. It should be presented as a contemporary insider reference, not as a universal symbol of the entire city.
- **Farza and Clicky:** A scene of a founder at a computer using an AI companion similar to Clicky. It represents Farza Majeed, his path from buildspace, and the culture of quickly creating and launching products. This is a high-difficulty or niche reference.

Representations of real people should be stylized or clearly parodic. The educational value is in the cultural context and product, not in reproducing an exact likeness.

## Editorial criteria for future scenes

Every scene should clearly answer these questions:

- What cultural reference does it represent?
- Can the reference be understood visually?
- Is there an interesting fact or context to teach?
- Does its difficulty match the player's progression?
- Can the explanation fit into a brief interaction?

Do not expand the scope or make major technical decisions without explicit direction from the user.

## Viral/social content sources (ScrapeCreators API)

After evaluating 6 endpoints across Reddit, Twitter, and TikTok, one source was selected:

### Selected: TikTok keyword search

- **Endpoint:** `GET https://api.scrapecreators.com/v1/tiktok/search/keyword`
- **Params:** `query` (required), `sort_by`, `date_posted`, `region`, `cursor`, `trim`
- **Filters used:** `query: "san francisco ai"`, `sort_by: "most-liked"`, `date_posted: "this-month"`
- **Cost:** 1 credit per call.
- **Why selected:** Captures visual viral moments (robots in SF, AI culture, builder grind) that translate well to cinematic Kling AI scenes. Strong engagement signals (millions of plays). Returns current month content, good for real-time discovery.
- **Hit rate:** ~30% (9 usable cards out of 30 videos). The curator agent must filter aggressively — ~70% is noise (tourists, generic AI takes, unrelated content using SF hashtags).
- **Example discoveries (Sep 2026):** Tau Robotics street cleaners (9.9M plays), Terminator walking SF (2.1M plays), "Make me a million dollars" Claude meme (1M plays), Luna AI boss firing a human employee, All-In Summit, anti-hustle-culture backlash.

### Card quality tiers from TikTok discovery

- **Corgi Cafe level** (strong visual, iconic): Tau Robotics cleaners, Terminator walks, Claude builder meme, Luna AI boss.
- **Clicky level** (niche, insider): Anti-hustle SF culture, robot boxing, All-In Summit, data center resistance, Anthropic regulation debate.
- **Noise** (filtered out): Tourist vlogs, generic AI opinions, sports content, non-English takes, random SF footage with no cultural reference.

### Rejected sources

- **Twitter user-tweets** — High insider signal but returns only ~100 all-time popular tweets per account (2019–2025). No time filter, no search endpoint. Cannot discover current/2026 trends.
- **Reddit r/sanfrancisco** — ~30% hit rate but mostly sunsets, photos, housing complaints.
- **Reddit r/bayarea** — ~12% hit rate. Duplicates r/sanfrancisco or irrelevant.
- **TikTok "sf founders"** — Too noisy. Generic hustle content, hashtag spam.
- **TikTok "silicon valley"** — Overlaps with "san francisco ai". Elizabeth Holmes content is notable but niche.

### Next step

Add both historical cards (from `output/historical-cards.json`) and viral cards (from TikTok discovery) to Cloudflare storage.
