# Steward architecture — September 5, 2026

A modular monolith: React Home/Plan/Activity, deterministic domain functions,
explicit edit/confirmation handlers, and deployment-specific server capabilities.
No RAG, agent framework, vector store, or new remote service was added.

## State boundaries

`Workspace` (`modelVersion: 1`) is now the live and persisted financial model.
`migrateWorkspace` imports old `StewardState` snapshots once. `useWorkspace` edits
canonical state directly instead of converting it to legacy state every render.
A workspace revision identifies the financial source used for a proposal; a
separate storage revision identifies the acknowledged server snapshot.

Existing metadata remains in `legacy` to preserve data during migration. A
compatibility export includes a canonical snapshot when old fields cannot express
all goal/bucket properties. Stable IDs, goal kinds/status/rank/pins/deadlines/account
links and merchant scopes survive that import. No workspace reset is performed.

Imported account/transaction facts, explicit bucket/claim overrides, calculated
plans, and confirmed allocation records have separate homes. `fundedAmount` means
base earmarks plus confirmed allocations, not bank transfers or observed debt
repayment. Bank sync updates facts while retaining canonical plan overrides.

## Commands and calculation

Draft → validation → preview → explicit Save/Confirm → canonical state → serialized
persistence → acknowledgement. `editPlanRow` and `reorderGoal` own their edits;
`confirmProposal` validates target IDs/amounts and source revision. Replacing a
cycle uses deltas over the union of old and new targets, including removed lines.

`planCycle`, `allocate`, and `buildPaydayProposal` own the numbers. Proposal building
removes the current cycle's existing allocations from the funding basis before
recomputing, so a replacement does not allocate a second paycheck. Plan and Ask
use this result. ConversationSetup presents full obligations, annualized usual rates,
current contributions and catch-up reasons before confirming.

Current liquidity is separate from expected paycheck capacity. Missing or stale
balances withhold positive buying-today verdicts. Pending expenses are protected
conservatively even when an adapter may already include them in available balance;
this can understate available cash. The adapter must certify balance semantics
before relaxing that protection. Non-USD private writes are rejected explicitly.
Money remains number-valued USD with cent validation/rounding at calculation and
command boundaries; this is not an integer-minor-unit migration of every legacy field.

Calendar calculations use UTC date-only semantics. Paydays are computed from the
original anchor. End-of-month schedules clamp correctly, including leap years.
Semimonthly import is withheld for review. Full irregular-income and arbitrary
semimonthly schedules remain unsupported.

## Persistence and bank sync

The client coalesces pending snapshots and permits one write in flight. A failed
latest draft is retained for explicit/online retry; conflict state directs the
user to export and reload. There is no unencrypted persistent outbox for private
financial data. Session-only manual/demo caches use separate per-route keys.

The API validates nested canonical entities and relationships and writes only the
parsed value. Snapshot CAS checks the exact previous JSON and expected storage
revision. GET is read-only and never clears legacy demo-like data.

Bank pagination collects a complete batch with bounded restart. D1 batch commits
facts and cursors together. Cursor writes are conditional on successful snapshot
CAS; a unique batch marker prevents a losing concurrent sync from advancing them.
Pending-to-posted replacements, duplicates, and manual correction preservation
are covered by deterministic tests. Live D1/Plaid behavior still needs integration
verification with approved sandbox fixtures and a trusted authentication gateway.

## Runtime boundaries

Sites: Worker plus optional D1, explicitly configured trusted gateway identity.
Vercel: process-env compatibility adapter; public demo/manual sessions, no D1.
Private routes fail closed without the identity adapter. Merely sending an email
header on the public Vercel adapter does not authenticate a user.

Paid AI is opt-in with bounded request bodies, two concurrent generations per
process, 50 calls per process/day, and capped output tokens. Those process limits
are backstops, not durable multi-instance billing controls. A shared budget and
operational policy remain prerequisites for a broader multi-tenant release. The
portfolio demo is enabled with these instance backstops.

Purchase scenarios use the same projection loop and calendar as the baseline,
with only an explicit first-cycle capacity reduction. Spending covered by a
matched everyday bucket consumes its remaining allowance; only the excess reduces
goal capacity. Current liquidity remains a separate gate.

Detected fixed subscriptions are recurring reserve obligations, with their full
charge, cadence, and next due date. Legacy automatically generated merchant
spending buckets migrate at load boundaries while retaining IDs. They are excluded
from discretionary overspending alerts.

The primary onboarding UI is ConversationSetup. POST /api/steward-chat uses the
Responses API to produce a structured ChatDraft with user evidence. The server
validates it and workspaceFromChat constructs a reviewable preview without writing
state. PlanCycle and evaluatePurchase compute the displayed financial results.
Only explicit client confirmation applies the draft to the revisioned workspace.
Ask uses the same model endpoint and retains explicitly labeled deterministic
calculation fallback during provider failure. See AI_SYSTEM.md for live evidence.
