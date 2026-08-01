# Changelog

## Plan-first recovery

- Restored budgets, category progress, debt, and paycheck orientation to the
  primary mobile experience.
- Recentered mobile navigation around Plan instead of Today.
- Kept Available Cash and one recommendation as the executive layer without
  allowing either to replace the underlying financial plan.
- Added an interpretation layer that explains category progress and provides
  the context behind recommendations.
- Added spending buckets to the detailed mobile paycheck plan.

## Financial chief-of-staff pivot

- Rebuilt Today around five immediate decisions: Am I okay, what is actually
  available, what is the biggest pressure, what should happen today, and can I
  buy this.
- Added deterministic financial-health, bottleneck, daily-decision, and
  BUY / WAIT / DO NOT BUY affordability engines.
- Upgraded recommendations with timing, tradeoffs, confidence, related context,
  and expected outcomes.
- Reframed Advisor prompts and Wishlist recommendations around decisions rather
  than transaction reporting.
- Reordered mobile navigation around Today, Plan, Projects, and Advisor.

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
