# Project status

## Complete

- Installable mobile-first PWA and preserved desktop application shell
- Action-first daily briefing
- Deterministic safe-to-spend and paycheck calculations
- Accounts, transactions, category correction, bulk categorization
- Bills, budgets, goals, projects, tasks, and wishlist
- Affordability questions and direct advisor answers
- Weekly and monthly review experiences
- Onboarding flow and editable financial preferences
- Structured memory and notification controls
- Global search, light/dark appearance, mobile navigation
- JSON/CSV export and confirmed data deletion
- Empty first-run workspace with bank-only onboarding
- D1 workspace persistence and audit log
- Normalized Drizzle schema and migrations
- Optional OpenAI Responses API service with structured output
- Plaid Link-token, token exchange, encrypted storage, multi-item account import,
  incremental transaction merge, account refresh, and cursor persistence
- Real activity-derived budgets, bills, payday profile, reviews, and recommendations
- Calculation and server-render smoke tests
- Environment, architecture, database, AI, Plaid, and security documentation

## Partially complete

- Plaid Recurring Transactions is optional account access; when unavailable,
  transaction sync continues but predicted bills and payday detection may be
  incomplete.
- Recommendation acceptance updates the current workspace; snooze scheduling is
  represented by status only.
- Reviews are functional stored summaries; background scheduled generation is
  not active.
- Notifications are fully functional in-app; email and push delivery are only
  architectural continuation points.
- The normalized database exists, but the UI currently uses atomic workspace
  snapshots rather than granular entity writes.

## Not complete

- Public email/password, magic-link, Google, or Apple auth. Sites identity is
  used instead; Supabase Auth is the planned public-consumer adapter.
- Plaid webhook ingestion and update-mode reauthorization. Item removal is
  performed during workspace deletion.
- Receipt/file uploads and R2 storage.
- Production background jobs and scheduled review generation.
- Browser-driven Playwright tests and cross-browser visual QA.
- Stripe subscription billing.

## External setup required

- OpenAI key for enhanced advisor explanations
- Plaid credentials and encryption key for bank connections
- Production access policy and runtime environment values

## Known issues

- D1 failure falls back to session state, so changes are not durable until
  storage reconnects.
- The dependency audit includes transitive development-tool findings that still
  require review before public production.

## Recommended next steps

1. Normalize snapshot mutations into entity routes with ownership tests.
2. Add verified Plaid webhook ingestion and update-mode reauthorization.
3. Add browser E2E coverage and accessibility testing.
4. Run a production security review.
5. Validate recommendations with 5–10 target users before adding billing.
