# Project status — September 5, 2026

Steward is an AI-led conversational planning application with deterministic calculations,
synthetic sample data, and manual session modes. It is not certified for general public banking use.

Implemented: canonical revisioned financial state, explicit bill and goal drafts,
reviewed onboarding/catch-up amounts, open-ended savings, current-liquidity guards,
allocation replacement, category corrections and splits, safe exports, serialized
save acknowledgements, conditional bank cursor commits, and a live Responses API function-tool workflow. Session state distinguishes
candidates, confirmed choices, assumptions, comparisons, and exact approved plans.
Onboarding now keeps conversation and financial cards visible through four stages, supports future-effective bill corrections, and separates exploration from proposed allocations. See docs/conversational-onboarding.md for the latest six live-model turns and full public-browser onboarding checks; AI_SYSTEM.md and docs/live-conversation-evaluation.md retain earlier evaluation evidence.
Stored check-in preferences do not deliver email or push notifications.

See [the 35-item review checklist](docs/steward-review-checklist.md) for each
implementation, verification status, and specific limitation. Local test/build and
staged-session browser evidence is in `outputs/steward-staged-verification.md`.

Private deployment needs a verified Sites identity boundary and D1; arbitrary
forwarded identity headers are not a public authentication mechanism. The Vercel
adapter intentionally fails private routes closed without those capabilities.
Plaid sandbox concurrency/rollback integration, production policy/security review,
durable AI budgets, physical accessibility testing, and real-user usability work
remain prerequisites for release. No real accounts were connected in verification.

Failed saves retain the latest in-memory state for retry and expose failure or
conflict. There is no encrypted durable private offline outbox; closing the tab
can lose unacknowledged changes. Sample/manual state is isolated in sessionStorage.
