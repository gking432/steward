# Steward architecture

## Shape

Steward is a server-rendered application shell with a rich client workspace.
Critical financial calculations live in `lib/engine.ts`; they never depend on a
language model. Steward’s deterministic decision layer produces Available
Cash, financial health, one primary bottleneck, a daily action, debt payoff
projections, and purchase verdicts. The UI is organized by user decisions
rather than database entities:

1. Today: health, Available Cash, primary bottleneck, next action, and purchase decision
2. Plan: paycheck allocation, budgets, goals, bills
3. Projects: priorities, progress, next purchase, and next action
4. Advisor: decision explanation, tradeoffs, and alternatives
5. Transactions and Accounts: supporting evidence and data controls

## Request boundaries

- `app/page.tsx` reads optional authenticated identity headers and renders an
  empty initial workspace.
- `app/api/steward/route.ts` owns durable state. It derives the user key from
  trusted server headers, validates writes with Zod, and records audit events.
- `app/api/advisor/route.ts` accepts a bounded financial context and a verified
  deterministic result. OpenAI can explain but cannot replace the result.
- `app/api/plaid/*` creates Link tokens, exchanges public tokens, encrypts access
  tokens, and incrementally synchronizes transactions.

## Persistence choice

The product brief suggested Supabase. The current Sites runtime has first-class
D1 and identity support, so D1 was selected for the deployed version. This
avoids two competing auth systems and keeps the application deployable without
external setup.

The application currently saves one atomic workspace snapshot per identity.
Normalized tables are included in the migration so entity-level writes can
replace the snapshot adapter without changing the UI or domain types.

## Authentication

Production identity is dispatch-owned Sign in with ChatGPT. The platform
forwards authenticated email and optional display name. Every data route ignores
client identity claims and derives ownership server-side.

For a public consumer launch outside Sites, replace this adapter with Supabase
Auth, maintain the same domain interfaces, and add PostgreSQL RLS policies keyed
to `auth.uid()`.

## External fallbacks

- No OpenAI key: deterministic advisor responses remain active.
- No Plaid credentials: the empty connect screen explains that the administrator
  must finish the one-time Plaid configuration.
- D1 unavailable: the browser keeps the current session usable and visibly
  reports session-only saving.
