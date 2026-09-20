# Meta App Review — threads_keyword_search

## Permission requested

`threads_keyword_search` — Advanced Access.

## Why the app needs it

Threads Outreach Agent is a 24/7 business lead-discovery and content-research assistant for the authenticated Threads account.

The permission is used only to search PUBLIC Threads posts for:
- explicit requests for chatbots, AI agents, business automation, CRM and lead-processing help;
- public discussions about operational problems that may indicate automation demand;
- current public discussions used as evidence for topic discovery before generating an original Threads post.

The app does not attempt to access private Threads content.

## User-facing functionality

1. The authenticated account authorizes the Threads app.
2. The service verifies the account with the Threads API.
3. The service calls `/keyword_search` using both `RECENT` and `TOP`.
4. Public results are scored for relevance.
5. Low-confidence/irrelevant results are ignored.
6. Relevant public posts may receive a contextual reply using the authorized account.
7. Trend discovery aggregates public search results and only generates original content when enough evidence exists.
8. The app monitors replies/mentions to continue a conversation.
9. Rate limits, per-user cooldown and opt-out handling prevent repetitive outreach.

## Example reviewer flow

### Public keyword search

Search query example:

`нужен чат бот`

Expected app behavior:
- call Threads `/keyword_search`;
- retrieve PUBLIC posts not owned by the authenticated account;
- score them for commercial intent and automation fit;
- persist only application state needed for the lead workflow.

### Trend research

Example queries:

`AI`, `ИИ`, `ChatGPT`, `OpenAI`

For each query the service requests both:
- `search_type=TOP`
- `search_type=RECENT`

The model is instructed not to claim a trend unless the supplied public evidence supports it.

## Safety / anti-spam controls

- deterministic lead relevance threshold;
- seller/competitor and job-seeker filters;
- hourly and daily outreach caps;
- per-user cooldown;
- duplicate post protection;
- explicit opt-out blocking;
- no fabricated results, clients, revenue, prices or urgency;
- weak trend evidence is skipped rather than published.

## Permissions currently used by the production app

- `threads_basic`
- `threads_content_publish`
- `threads_keyword_search`
- `threads_manage_insights`
- `threads_manage_mentions`
- `threads_manage_replies`
- `threads_profile_discovery`
- `threads_read_replies`

Only request Advanced Access for permissions required by the reviewed flow.

## Reviewer evidence to record

Record one continuous screen capture showing:

1. Sign in / authorize the Threads app.
2. Open the running Threads Outreach Agent dashboard.
3. Trigger or wait for a keyword-search cycle.
4. Show a public Threads post returned by the search.
5. Show the resulting relevance decision/draft in the app.
6. Show that a non-relevant post is ignored.
7. If demonstrating publishing, post/reply from a dedicated reviewer/test account only.
8. Show the app dashboard status and the permission-dependent functionality.

Do not include access tokens, app secrets, database credentials or other secrets in the recording.

## Production diagnostics

The application explicitly detects the case where `/keyword_search` returns only posts owned by the authenticated account.

Dashboard states:
- `Public discovery: OK` — external public results are available.
- `Public discovery: BLOCKED` — the permission exists in the token but public discovery is not available.
- `THREADS_KEYWORD_SEARCH_PERMISSION_MISSING` — token does not include the required scope.
- `THREADS_KEYWORD_SEARCH_OWN_ONLY` — search returned only the authenticated account's posts.

This prevents the application from pretending that public lead discovery is operational when it is not.

## Meta review checklist

- Threads use case is enabled for the Meta app.
- `threads_keyword_search` is added to the App Review request.
- Business Verification is complete if required for Advanced Access.
- Data handling / privacy questions are complete.
- A successful API call using the requested permission has been made recently.
- Reviewer instructions explain exactly how to reproduce the search flow.
- Screen recording demonstrates the exact permission-dependent feature.
- Test/reviewer access is available if Meta requests it.
- Privacy Policy URL and app contact details are current.
