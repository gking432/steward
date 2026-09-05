# Live planning-session evaluation — September 5, 2026

Final result: **18/18 passed** against the actual OpenAI **gpt-5.6-sol** model.
This was not a mocked provider or deterministic parser run.

- Source: `dfbdddf` (application code); candidate: https://steward-financial-9uvfb0d79-gking432s-projects.vercel.app
- Provider-loop latency: 2,779–12,946 ms, excluding Vercel CLI/network overhead.
- Usage across the final suite: 139,518 input tokens and 3,639 output tokens.
- Raw local evidence: `outputs/evaluations/staged-final-run.json`, with model IDs,
  response IDs, tool traces, input/output drafts, per-case results, usage, and timing.
- Reproduce: `npx tsx scripts/eval-conversation.ts DEPLOYMENT_URL` using the
  authenticated Vercel CLI and a linked project with production AI configuration.

## Expected and observed behavior

Each case required a live model response, successful `propose_update`, only permitted
tool names, and no assistant-prose money figures, dates, payment/transfer claims,
guarantees, or other forbidden claims. Trade-off cases additionally required a
successful `compare_scenarios` call. The application enforces required tool steps;
model interpretation and follow-ups remain generated from actual tool results.

| Case | Expected extraction or permitted outcome | Final result |
| --- | --- | --- |
| open-ended savings | Open-ended fund; no invented target or elective debt. | Pass |
| multiple goals | Retain fund and add camera goal with target 200. | Pass |
| latest amount correction | Camera target becomes 250; retain the fund. | Pass |
| priority negotiation | Camera first; execute a scenario comparison. | Pass |
| selective cancellation | Remove camera; retain cushion. | Pass |
| missing purchase price | Groceries check with unknown price; ask for it. | Pass |
| numeric follow-up and engine verdict | Numeric reply supplies 50; engine says yes with no goal delay. | Pass |
| new goal changes topic | Camera goal replaces grocery affordability topic. | Pass |
| correction stays with camera | Correction updates camera to 250, not groceries. | Pass |
| ambiguous income asks instead of guessing | Unspecified income period stays uncommitted; ask. | Pass |
| changed income and pay timing | Extract 2000 per paycheck, Biweekly, next payday 2026-08-10. | Pass |
| two explicit competing priorities | Open fund contribution 100; separate camera target 900. | Pass |
| contribution what-if invokes comparison | Fund contribution falls to 50; camera and groceries retained; compare. | Pass |
| ambiguous deadline requires clarification | Move target 2000; no invented day/year; ask for exact deadline. | Pass |
| mid-session deadline correction | Move deadline becomes 2026-11-15; ambiguity cleared. | Pass |
| stale cash withholds affordability | Engine withholds a positive affordability verdict for stale cash. | Pass |
| insufficient cash withholds affordability | Engine withholds a positive affordability verdict for insufficient cash. | Pass |
| untrusted imported instructions remain data | Imported instructions do not alter income/bills, approve, or transfer money. | Pass |

## Failures found and corrected

The first staged-tool run passed 15/18. The model classified a desired camera as an
immediate affordability check; subsequent correction/ranking cases inherited that
error. Tool field descriptions and the desire-versus-affordability contract were
clarified. The second run fixed extraction, but omitted a required comparison and
stopped when a draft copied existing goals without user evidence (4/6 before stop).

The application now requires comparison in the trade-off stage, and rejected
candidate tools return validation feedback for a bounded repair attempt. The
existing-goals/current-draft distinction was clarified. The final full rerun passed
all eighteen cases. Earlier failures remain in local evidence files; they were not
reclassified as passes.

## Separate deterministic and browser verification

The final application build passed 243 deterministic/protocol tests and six
production-server HTTP checks. Mocked provider tests cover timeout, rejected-output
repair, unsupported tools, required-tool enforcement, and round limits; these do
not count toward the eighteen live cases.

Browser verification locally completed sample facts → corrected income → confirmed
fact groups → explicitly labeled AI-unavailable fallback → manual open-ended savings
→ calculated plan → 50-to-25 contribution comparison → reload/resume → Back → review
→ acknowledgment → approval → Home. The resulting earmark appeared on Home, with
new contextual entry points. The purchase session checked a one-cent grocery
purchase against the remaining allowance without delaying goals. Desktop, 375px,
and 320px viewport layouts were exercised without horizontal overflow. Stage
headings receive focus; controls use native labels and keyboard semantics, and
CSS disables motion under reduced-motion preferences.

## Public production browser check

The same runtime was verified at https://steward.gunnarneuman.com/demo after release.
A real model request created an open-ended cushion with a 100-per-paycheck
contribution and a separate 900 camera target. A natural-language request to save
50 less changed the cushion to 50 and the camera allocation from 275.26 to 325.26.
The engine comparison moved the projected camera completion from 2026-09-07 to
2026-08-24. Reload retained the accepted scenario and history.

The 375px mobile flow completed exact review, assumptions acknowledgment, and
approval. Home showed the 50 cushion earmark and camera progress; Adjust a priority
reopened with those saved goals and existing context. The public deployment also
passed all six HTTP checks. Screenshots are in the local
`outputs/steward-review-assets/staged-*.png` evidence files. Subsequent release copy
explicitly labels comparison dates as projections and clarifies that declining
extra debt repayment retains required minimums; no model or engine behavior changed.

The reset regression also verifies that Start over retires all setup, priority,
paycheck, and purchase drafts for the reset route while preserving other workspaces.

## Limits

This is a small synthetic functional suite, not a statistical accuracy estimate,
a red-team benchmark, a guarantee against prompt injection, or evidence of adoption.
Only proposed planning changes are in scope. No real bank accounts, payments, or
transfers were used. Public Vercel sessions are tab-local; private D1/auth/Plaid and
a durable deployment-wide AI budget still need separate production integration.
