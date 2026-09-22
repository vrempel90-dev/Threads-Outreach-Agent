# Threads Outreach Agent

Production-oriented lead-generation agent for **Threads**, focused specifically on selling:

- AI agents / ИИ-агенты;
- chatbots for Telegram, WhatsApp and customer support;
- AI administrators and assistants;
- CRM/workflow automation;
- lead, sales, support and appointment automation.

## Core loop

`DISCOVER → FILTER → SCORE → AI QUALIFY → DRAFT/REPLY → FOLLOW UP → HOT LEAD`

The project is designed to find **buyer intent**, not merely posts mentioning AI.

## Lead discovery

Public Threads discovery is performed through **SocialCrawl Threads search** when `SOCIALCRAWL_API_KEY` is configured.

The default search pack contains Russian and Kazakh high-intent phrases such as:

- `нужен чат-бот`
- `нужен AI агент`
- `ищу разработчика AI агента`
- `бот для WhatsApp бизнес`
- `AI администратор для бизнеса`
- `автоматизация отдела продаж`
- `автоматизация поддержки клиентов`
- `чат бот керек`
- `AI агент керек`
- `бизнесті автоматтандыру керек`

`LEAD_LOOKBACK_DAYS` controls freshness; the default is 7 days.

## Qualification

A candidate must have both:

1. relevance to AI agents, chatbots or business automation; and
2. real commercial intent or a concrete operational pain that the author wants to automate.

The deterministic filter rejects common false positives before the LLM is called:

- AI agencies/developers promoting their own services;
- people looking for clients;
- vacancies, resumes and job seekers;
- human professions containing the word “agent” (real-estate agent, travel agent, etc.);
- generic AI discussions without buying intent.

Kazakhstan/CIS signals increase priority but **never create buyer intent by themselves**.

The LLM then performs a second strict buyer/seller/job/general classification.

## Threads operations

The official Threads API is used for supported account and conversation actions implemented by the project, including publishing/replies, mentions and resolving candidate post data where available.

The application does not assume access to unsupported private-message capabilities.

## Content engine

The content worker researches live Threads discussions around AI agents, chatbots and business automation and drafts original Russian posts.

The prompt optimizes for:

- a specific hook rather than generic AI hype;
- one concrete business implication;
- useful operational insight around leads, sales, support, appointments or CRM;
- varied structures (contrarian observation, teardown, costly mistake, before/after process);
- qualified inbound conversations rather than empty engagement.

No system can guarantee that an individual post will become viral. The agent is instructed to optimize for relevance, specificity, saves, replies and commercial interest without fabricating claims or statistics.

## Modes

### `AGENT_MODE=review`

Finds and qualifies real opportunities and stores outreach/content as drafts. Nothing is published automatically.

### `AGENT_MODE=autonomous`

Queued replies/content may be published subject to configured rate limits and cooldowns.

Start in `review`.


## Railway setup mode

The service can boot safely before `THREADS_ACCESS_TOKEN` and `OPENAI_API_KEY` are added.

In that state:

- PostgreSQL migrations and the HTTP dashboard can start;
- `/healthz` remains available for infrastructure health checks;
- `/readyz` returns `503` with a `missing` list until the required API keys are present;
- hunter, inbound, content and publishing loops do not run;
- `AGENT_MODE=review` should remain enabled until the first real lead and reply tests are verified.

This allows Railway infrastructure to be prepared first and secrets to be added later without using fake credentials.

## Required configuration

```env
DATABASE_URL=
THREADS_ACCESS_TOKEN=
OPENAI_API_KEY=

SOCIALCRAWL_API_KEY=
SOCIALCRAWL_BASE_URL=https://www.socialcrawl.dev

AGENT_MODE=review
HUNTER_INTERVAL_SECONDS=300
LEAD_LOOKBACK_DAYS=7
MIN_LEAD_SCORE=55
MAX_OUTREACH_PER_HOUR=3
MAX_OUTREACH_PER_DAY=10
USER_COOLDOWN_DAYS=7
```

Optional `SEARCH_QUERIES` overrides the built-in high-intent query pack. Separate phrases with `|`.

## Run and verify

```bash
npm ci
npm run build
npm test
npm start
```

CI runs TypeScript compilation and tests for `main` and pull requests targeting `main`.

## Safety

- deduplicates seen posts and conversations;
- applies per-user cooldowns;
- enforces hourly/daily outreach caps;
- supports opt-out blocking;
- never lets location alone qualify a lead;
- prompts the LLM not to invent prices, clients, metrics, integrations or results;
- keeps review mode available before autonomous publishing.
