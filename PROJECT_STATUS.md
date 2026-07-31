# Project status

## Complete

- Responsive Steward application shell and all primary navigation
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
- Realistic demo mode
- D1 workspace persistence and audit log
- Normalized Drizzle schema and migrations
- Optional OpenAI Responses API service with structured output
- Plaid Link-token, token exchange, encrypted storage, account import, and sync
- Calculation and server-render smoke tests
- Environment, architecture, database, AI, Plaid, and security documentation

## Partially complete

- Plaid transaction sync returns and cursors updates but does not yet merge them
  into the normalized transaction table.
- Recurring expenses are represented in transaction and bill data; automatic
  pattern detection and price-change history are not implemented.
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
- Plaid webhook ingestion, update-mode reauthorization, and item removal.
- Receipt/file uploads and R2 storage.
- Production background jobs and scheduled review generation.
- Browser-driven Playwright tests and cross-browser visual QA.
- Stripe subscription billing.

## External setup required

- OpenAI key for enhanced advisor explanations
- Plaid credentials and encryption key for bank connections
- Production access policy and runtime environment values

## Known issues

- Demo dates are generated relative to the current date; archived review labels
  remain sample copy.
- D1 failure falls back to session state, so changes are not durable until
  storage reconnects.
- The dependency audit includes transitive development-tool findings that still
  require review before public production.

## Recommended next steps

1. Normalize snapshot mutations into entity routes with ownership tests.
2. Complete Plaid webhook ingestion and transaction merge logic.
3. Add browser E2E coverage and accessibility testing.
4. Run a production security review.
5. Validate recommendations with 5–10 target users before adding billing.
