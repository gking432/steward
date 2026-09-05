# Project status — September 5, 2026

Steward is an AI-led conversational budgeting application with deterministic calculations with synthetic sample and manual
session modes. It is not certified for general public banking use.

Implemented: canonical revisioned financial state, explicit bill and goal drafts,
reviewed onboarding/catch-up amounts, open-ended savings, current-liquidity guards,
allocation replacement, category corrections and splits, safe exports, serialized
save acknowledgements, conditional bank cursor commits, and a live Responses API conversation. Nine scripted live turns passed; see AI_SYSTEM.md.
Stored check-in preferences do not deliver email or push notifications.

See [the 35-item review checklist](docs/steward-review-checklist.md) for each
implementation, verification status, and specific limitation. Local test/build and
browser evidence is in `outputs/steward-verification.md`.

Private deployment needs a verified Sites identity boundary and D1; arbitrary
forwarded identity headers are not a public authentication mechanism. The Vercel
adapter intentionally fails private routes closed without those capabilities.
Plaid sandbox concurrency/rollback integration, production policy/security review,
durable AI budgets, physical accessibility testing, and real-user usability work
remain prerequisites for release. No real accounts were connected in verification.

Failed saves retain the latest in-memory state for retry and expose failure or
conflict. There is no encrypted durable private offline outbox; closing the tab
can lose unacknowledged changes. Sample/manual state is isolated in sessionStorage.
