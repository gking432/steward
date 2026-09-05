# Steward

Steward is a calm paycheck-planning assistant with staged AI sessions and an ongoing Home, Plan, and Activity workspace.
Its financial calculations are deterministic. Planning and confirming allocations
**earmark money only**; they never transfer funds, pay debt, or prove a bill was paid.

## Try it

- `/fixture`: immediately explore the dated synthetic household.
- `/demo`: confirm sample facts, explain your priorities to live AI, build a
  calculated plan, compare trade-offs, and explicitly approve its allocations.
- `/manual`: build a session-only plan without a bank connection.
- `/`: load a private workspace when verified identity and storage are configured;
  sample/manual entry stays available while loading.

Sample and manual plans are stored in sessionStorage for this browser tab. Reload
preserves changes; closing the tab can lose them. Export JSON/CSV in Settings.
Private drafts remain in memory after a failed save; export before closing.

## What is implemented

- Distinct full bill amounts and current contributions; validated drafts and
  explicit Save/Cancel; readable cents and priority/contribution controls.
- Open-ended savings, optional extra debt repayment, current/usual plan views.
- Net spending allowances include category overruns. Buying-today checks separately
  protect current cash, unpaid obligations, pending activity, earmarks, and buffer.
- Merchant-scoped recurring buckets, transaction categorization, splitting,
  merchant/account/date filters, categorization undo, and formula-safe CSV export.
- Canonical versioned workspace; one-way legacy import; goal properties retained
  in JSON exports and compatibility exports.
- Serialized/coalesced saves, compare-and-swap conflicts, bounded requests and
  explicit retry/export recovery. Private endpoints fail closed by default.
- Read-only bank sync implementation with pagination restart, deduplication,
  preservation of user corrections, and atomic conditional transaction/cursor commit.
- Application-owned session stages, strict model function tools, candidate fact
  confirmation, before/after scenarios, guarded approval, and manual failure recovery.
- Contextual Home sessions for priority changes, paycheck review, and purchases.

## Run and verify

Node.js 22.13+ is required. Use the existing lockfile: `npm ci` if dependencies are
missing. `npm run dev` starts the Sites/Vinext development server.

- `npm test`: deterministic business and integration-unit regressions.
- `npm run lint`: ESLint.
- `npm run build`: Cloudflare Worker/Sites build.
- `npm run test:build`: Vercel Next.js production build, tests, and HTTP checks
  against a freshly started production server on port 3002.
- Vercel preview: `VERCEL=1 npx next start -p 3001` after `test:build`.

## Deployment capabilities and limits

Vercel is the public synthetic demo target. Its compatibility adapter provides
process environment access, **not D1 or private identity**. Sites supplies the
Worker/D1 runtime; configure `STEWARD_AUTH_ADAPTER=sites-gateway` only behind a
trusted gateway that strips client-supplied identity headers. Production private
use requires verification of that gateway contract. `local` is an explicit local
adapter and is rejected when NODE_ENV is production.

AI generation is off unless `STEWARD_AI_ENABLED=true` and an OpenAI key are both
configured. Critical purchase verdict wording is deterministic. Conversation generation
has per-process request/concurrency/call/token limits; a shared gateway spend limit
remains necessary before a broader multi-tenant release. This portfolio demo is enabled with those instance backstops.
The main planning sessions use OpenAI Responses function calling to interpret conversation and invoke narrow planning tools. The financial engine calculates results. AI failure is explicit, with retry and manual calculation paths.

Bank routes require verified identity, D1, Plaid credentials, and encryption setup.
No real accounts were connected during the September review implementation. Live
banking, token rotation/retention, and disaster recovery still require operator
integration testing and policy decisions. Do not treat this release as certified
for real-user banking. Check-in delivery is not implemented.

Planning currently supports USD and Weekly/Biweekly/Monthly pay. Semimonthly bank
income is not silently mapped to biweekly: automatic scheduling is withheld for
manual review. See the dated review checklist for remaining calendar limits.

## Evidence and architecture

- [Review checklist](docs/steward-review-checklist.md)
- [Architecture](ARCHITECTURE.md)
- [AI behavior](AI_SYSTEM.md)
- [Verification report](outputs/steward-verification.md)
- [Security](SECURITY.md)

## Conversational onboarding

Start at `/demo` to talk with Steward about priorities and build a draft. Inspect
statements at `/demo?statements=1`, or skip onboarding with `/fixture`. Review the
calculated plan and catch-up amounts before confirming. Model calls are enabled
on the Vercel deployment. See AI_SYSTEM.md for the actual nine-turn live evaluation
and its limits. This is a working AI portfolio demo, not evidence of user adoption.
