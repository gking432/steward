# Steward

Steward is an AI financial chief of staff. It connects balances, bills, debt,
savings, goals, projects, and desired purchases to reduce financial decision
fatigue and answer one practical question: **what should I do next?**

The application starts with an empty, private workspace. A user connects a bank
once; Steward imports balances and transaction history and derives the plan from
that real activity. Critical arithmetic, paycheck planning, categorization
rules, affordability checks, and recommendations are deterministic.

## What works

- Action-first daily financial briefing
- Automatic financial-health status and primary-bottleneck detection
- Protected Available Cash as the product’s primary number
- Deterministic BUY / WAIT / DO NOT BUY affordability decisions
- One daily recommendation with reason, impact, confidence, timing, tradeoffs,
  and expected outcome
- Installable mobile-first PWA with dedicated bottom navigation and safe-area
  support
- Preserved desktop application shell and primary navigation
- Paycheck allocation planner with live reconciliation
- Safe-to-spend and affordability engine
- Accounts, transactions, categories, bills, budgets, and goals
- Projects with tasks, progress, cost context, and next actions
- Wishlist timing and purchase recommendations
- Deterministic advisor with an optional OpenAI explanation layer
- Weekly and monthly review surfaces
- Structured AI memory controls
- Global search, in-app notifications, light/dark modes
- JSON and CSV export plus account-data deletion
- D1-backed per-user workspace persistence and audit records
- Plaid Link, secure exchange, encrypted token storage, multi-item incremental
  sync, account refresh, and real workspace ingestion
- Derived bills, budgets, payday details, reviews, and recommendations from
  connected activity

## Stack

- Vinext / Next.js App Router, React 19, TypeScript
- Tailwind build pipeline plus product-specific CSS
- Cloudflare Workers and D1
- Drizzle schema and generated SQLite migration
- Zod validation
- OpenAI Responses API, isolated behind a server-only service
- Plaid REST API, Link, Web Crypto AES-GCM token encryption
- Node test runner with `tsx`

Sites uses Vinext to produce a Cloudflare Worker-compatible deployment. This is
the practical deployment target for the current repository. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for the decision and the future standalone
Supabase path.

## Local setup

Requirements: Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Local D1 state is managed by the Cloudflare development runtime declared in
`.openai/hosting.json`. Bank connection requires a configured Plaid application.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | No | Canonical application URL |
| `OPENAI_API_KEY` | No | Enables personalized explanation rewriting |
| `OPENAI_MODEL` | No | Defaults to `gpt-5.6-luna` |
| `PLAID_CLIENT_ID` | For Plaid | Plaid application identifier |
| `PLAID_SECRET` | For Plaid | Plaid environment secret |
| `PLAID_ENV` | For Plaid | `sandbox`, `development`, or `production` |
| `PLAID_WEBHOOK_URL` | For Plaid | Public transaction webhook URL |
| `APP_ENCRYPTION_KEY` | For Plaid | Long random secret used to encrypt access tokens |

Never expose `OPENAI_API_KEY`, `PLAID_SECRET`, or `APP_ENCRYPTION_KEY` to the
client.

## Database

The D1 binding is named `DB`. Schema definitions live in `db/schema.ts`;
generated migrations live in `drizzle/`.

```bash
npm run db:generate
```

The current product writes a cohesive, user-owned workspace snapshot for atomic
save behavior while also defining normalized entities for the next granular
write migration. See [DATABASE.md](./DATABASE.md).

## Authentication

The deployed Sites application uses dispatch-owned Sign in with ChatGPT and
authenticated identity headers. D1 rows are keyed server-side by the forwarded
email; client-provided user IDs are ignored.

This intentionally replaces the brief’s standalone email/password and social
OAuth implementation because the selected hosting platform supplies identity
and prohibits scaffolding a separate public auth system from the starter. A
future public standalone deployment should use Supabase Auth.

## Plaid

1. Create a Plaid developer account and obtain Sandbox credentials.
2. Set `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV=sandbox`, and a strong
   `APP_ENCRYPTION_KEY`.
3. Restart the app and choose **Connect your bank**.
4. Complete Plaid Link. Steward saves accounts immediately and imports available
   transaction history.

Access tokens are exchanged and encrypted on the server. They are never returned
to the browser. See [PLAID_SETUP.md](./PLAID_SETUP.md).

## OpenAI

Set `OPENAI_API_KEY` to enable personalized advisor explanations. Steward sends
only a bounded context object plus the deterministic answer. The model is told
not to recalculate financial values and receives financial record text as
untrusted data. Requests use structured output and `store: false`.

Without the key, the advisor uses the deterministic fallback. See
[AI_SYSTEM.md](./AI_SYSTEM.md).

## Validation

```bash
npm test
npm run test:build
npm run lint
```

`test:build` creates the production Worker, runs calculation tests, and checks
the server-rendered product surface.

## Deployment

The repository is configured for OpenAI Sites. Build with `npm run build`; Sites
packages the generated Worker, applies D1 migrations, and deploys a saved
version.

For another Cloudflare target, provide a D1 database binding named `DB` and
Worker runtime environment variables matching `.env.example`.

## Security

Read [SECURITY.md](./SECURITY.md) before enabling real financial data. The
present release is appropriate for controlled private evaluation; it
still needs a formal security review, rate-limiting service, verified Plaid
webhook signatures, and production incident procedures before broad public use.

## Project documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [DATABASE.md](./DATABASE.md)
- [AI_SYSTEM.md](./AI_SYSTEM.md)
- [PLAID_SETUP.md](./PLAID_SETUP.md)
- [SECURITY.md](./SECURITY.md)
- [PROJECT_STATUS.md](./PROJECT_STATUS.md)
- [ROADMAP.md](./ROADMAP.md)
- [CHANGELOG.md](./CHANGELOG.md)
