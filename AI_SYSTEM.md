# AI system

Steward uses the OpenAI Responses API for its main onboarding conversation and
natural-language Ask requests. The model maintains structured, unconfirmed goals,
amount corrections, priorities, and purchase intent across the transcript. The
front door is `/demo`; the statement inspection is optional.

The model receives messages and selected plan facts, not bank credentials. Output
uses a strict JSON schema, then application validation checks known IDs, amounts,
and user-quoted evidence. Evidence checks establish provenance, not a mathematical
proof of semantic correctness; the user reviews interpretations before applying.

The financial engine owns allocations, liquidity, goal dates and purchase verdicts.
The model's conversational text cannot apply changes. Financial figures and verdicts
are rendered from deterministic cards. Confirmation uses the reviewed workspace
revision. A failed or rejected model call is visible; onboarding keeps its draft
and offers retry/manual review, while Ask explicitly labels calculation fallback.

Configuration: server-only OPENAI_API_KEY and STEWARD_AI_ENABLED=true. The default
model is gpt-5.6-sol. Vercel production has AI enabled. Requests have bounded input,
a twenty-second provider timeout, strict output schema, a 2,400-token output cap,
and store:false. Existing routes retain their own output caps. In-process limits
allow two concurrent generations, fifty calls per day, and twenty endpoint
requests per minute. These are instance backstops, not a shared deployment-wide
spending guarantee; a durable global budget remains production-readiness work.

## Actual live evaluation

On September 5, 2026, nine scripted turns passed against an actual Vercel candidate
using the configured OpenAI model: open-ended savings, multiple goals, correction,
priority ordering, selective cancellation, missing purchase price, numeric reply
with deterministic verdict, topic switch, and correction on the new topic.
Run `npx tsx scripts/eval-conversation.ts DEPLOYMENT_URL` to repeat. The report at
`outputs/live-conversation-evaluation.json` records provider model and response IDs,
usage, latency, inputs and outputs. This is a small functional evaluation, not a
claim of production accuracy, user adoption, or broad adversarial robustness.
