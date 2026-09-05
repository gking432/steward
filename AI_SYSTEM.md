# How Steward’s AI works

Steward’s onboarding is a persistent conversation with financial cards, backed by the live
OpenAI Responses API. The model interprets priorities, extracts candidate facts,
handles corrections and topic changes, asks about ambiguity, and selects narrowly
scoped tools. The application owns stage transitions, financial arithmetic,
persistence, and approval.

## A session, not a free-writing agent

`PlanningSession` separates:

- Source financial context and the workspace revision/date it came from.
- User-confirmed income, bill, and spending groups.
- Candidate `ChatDraft` interpretations, including exact user-quoted evidence.
- Accepted intent, unresolved questions, and deterministic projection assumptions.
- A previous scenario for comparison and the identity of the exact reviewed plan.

Onboarding keeps its transcript visible through Your picture, Your goals, Your plan, and Review. Clear facts update the session directly; exploration and ambiguity cannot introduce new allocations or uncertain fact changes. The initial synthetic findings are calculated locally, not presented as a live-model generation. Home continues with contextual priority,
paycheck, and purchase sessions. Back retains completed work. A versioned,
validated sessionStorage snapshot restores drafts in the same tab. Earlier fact
edits invalidate confirmation/review and recalculate downstream results.

## Model tools

The server exposes strict JSON-schema function tools through Responses:

| Tool | Permitted result |
| --- | --- |
| `read_context` | Return selected financial context with confirmation status. |
| `propose_update` | Validate a complete candidate interpretation and calculate its draft allocations. |
| `calculate_plan` | Run the deterministic paycheck engine on the current candidate. |
| `compare_scenarios` | Return engine-calculated before/after contributions and projected arrival dates. |
| `prepare_review` | Return proposal metadata and an explicit requirement for user approval. |

No tool writes a workspace, accesses banking credentials, transfers money, or pays
bills. Function call outputs and reasoning items are returned to the model through
a bounded tool loop. The UI records completed tool names in session history.
Only a successful validated `propose_update` can become a candidate. The application
requires that tool on every turn and `compare_scenarios` in the trade-off stage.
Other tool selection remains model-driven. A rejected tool result is returned to
the model for repair within the same round/time bounds; rejected calls never count
as successful tool completion.

The model receives user messages and selected plan/account information. Raw
transaction descriptions are excluded. Imported names and all transcript content
remain untrusted data under the developer contract. Exact user evidence, known
IDs, calendar dates, cents, and field allowlists are checked after generation.
Evidence proves provenance, not semantic truth: the user sees session updates and can correct them before final plan approval. Financial numbers and dates in assistant prose
are suppressed; numerical explanations, affordability checks, allocations, and
comparison cards come from the engine.

## Approval and financial ownership

`planCycle`, `buildPaydayProposal`, `projectArrivals`, and `evaluatePurchase` own
calculations. Projections assume unchanged future income and spending, with scheduled bill changes applied to the first obligation on or after their effective date. Current
cash remains separate from projected income and proposed/confirmed earmarks.

Approval requires the exact reviewed candidate, confirmed financial groups,
resolved required questions, acknowledged assumptions, a matching source revision
and planning date, and a plan without a shortfall. `confirmProposal` then applies
validated allocation deltas to the canonical workspace. It never moves bank money.
A stale review cannot be applied. Model `readyToReview` is not authorization.

## Failure, configuration, and bounds

The Vercel demo has server-only `OPENAI_API_KEY` and `STEWARD_AI_ENABLED=true`.
`OPENAI_MODEL` is optional; the default is `gpt-5.6-sol`. Local AI requires those same
server settings. Without them, the interface explicitly says AI is unavailable
and offers retry. Onboarding also keeps optional fact editors; ongoing planning retains its manual priority, comparison, and purchase controls.
Interrupted requests retain the prior candidate; late responses cannot overwrite a
newer session. Manual actions are labeled manual, never live AI.

Each planning request has a 40-second provider-loop timeout, up to four provider
responses, up to six function calls, and a 2,400-token output cap per response.
The client stops waiting after 45 seconds and supports an immediate Stop action.
Responses use `store:false`. Request-body, transcript, and schema sizes are bounded.
Process-local limits allow two concurrent generation sessions, fifty sessions/day,
and twenty endpoint requests/minute. They are instance backstops, not a durable
multi-instance spend guarantee; a shared budget remains broader-release work.

## Evaluation evidence

Run `npx tsx scripts/eval-conversation.ts DEPLOYMENT_URL` against a protected Vercel
candidate using the authenticated CLI. This invokes the actual configured model
with synthetic data, recording model IDs, response IDs, completed tools, usage,
latency, and individual results in `outputs/live-conversation-evaluation.json`.
Expected extraction/actions are executable assertions; assistant claims and tool
names have shared forbidden/allowlist checks. See
[the live evaluation report](docs/live-conversation-evaluation.md) for actual results.

Deterministic tests and mocked provider protocol tests are reported separately.
They cover stage guards, confirmations, stale reviews, serialization, comparisons,
invalid output, prompt-injection provenance, timeout, unsupported tools, and call
limits. The financial regression suite also covers budgeted spending, completed
goals, recurring charges, insufficient/stale cash, and topic corrections.

This is a functional portfolio implementation and a bounded synthetic evaluation,
not evidence of adoption, broad model accuracy, or production banking operations.
