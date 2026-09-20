# Threads Outreach Agent

Production lead-generation agent for Threads focused on **AI agents, chatbots and business automation**.

## Real workflow

`Threads keyword search → deterministic lead scoring → LLM context reply → PostgreSQL → review/autonomous publish → reply monitoring → follow-up → HOT lead notification`

This is not a UI mock. The runtime calls Threads API for account verification, keyword search, publishing replies/posts, mentions and reading replies. It stores leads, seen posts, drafts, sent messages and inbound replies in PostgreSQL.

## Modes

- `AGENT_MODE=review` — discovers leads and creates real drafts in PostgreSQL, but does not publish.
- `AGENT_MODE=autonomous` — publishes queued replies/content through Threads API with hourly/daily limits and per-user cooldowns.

Start in `review`, inspect generated outreach, then switch to `autonomous` after confirming tone and account permissions.

## What it does

- rotates commercial search queries in Russian/Kazakh;
- rejects obvious competitors/self-promotion and job-seeking posts;
- scores commercial intent, business pain, automation fit and business context;
- generates post-specific replies instead of generic ads;
- enforces hourly/daily caps and a per-user cooldown;
- polls replies to its sent Threads and direct mentions;
- follows up inside the same Threads conversation;
- marks explicit price/demo/meeting intent as HOT and can notify the owner in Telegram;
- generates B2B Threads content designed to expose real operational pain and produce qualified conversations;
- provides `/healthz`, `/readyz` and a live dashboard.

## Environment

See `.env.example`. Required for boot: `DATABASE_URL`, `THREADS_ACCESS_TOKEN`, `OPENAI_API_KEY`.

`SEARCH_QUERIES` accepts custom phrases separated with `|`.

## Verification

The Docker build runs TypeScript compilation and unit tests. Railway health checking uses `/healthz`; runtime readiness including PostgreSQL + Threads identity is exposed at `/readyz`.
