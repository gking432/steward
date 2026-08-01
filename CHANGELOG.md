# Changelog

## Unified paycheck buckets

- Added one mobile Plan view for bills, everyday spending, debt, goals,
  projects, and the protected cash buffer.
- Added editable per-paycheck assignments and source-specific progress labels
  and percentages.
- Reworked onboarding to ask about income, bills, real spending categories,
  goals, and projects before constructing the plan.
- Added current-pay-period spending calculations so category percentages use
  activity from the active paycheck cycle rather than generic monthly totals.

## 2026-07-30

- Initialized Steward as a new full-stack financial operating system.
- Added responsive daily briefing, planning, transactions, projects, wishlist,
  advisor, reviews, accounts, onboarding, and settings.
- Added deterministic financial tradeoff and paycheck engines.
- Added an empty first-run workspace; no sample financial records ship.
- Added D1 persistence, normalized schema, migration, and audit records.
- Added optional OpenAI Responses API explanation service.
- Added Plaid Sandbox-compatible Link, exchange, encryption, import, and sync.
- Added exports, deletion, structured memory, notifications, themes, and search.
- Added automated tests and project documentation.
- Added an installable mobile-first PWA without changing the desktop shell.
- Completed Plaid-to-workspace ingestion for accounts, transactions, recurring
  cash flows, budgets, reviews, payday details, and recommendations.
