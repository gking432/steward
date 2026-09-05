# Conversational onboarding correction

The sample and manual onboarding entry now use one persistent conversation. A synthetic-account summary is calculated on entry; it is not described as a live model response. “Looks right” confirms the starting picture and opens the motivation conversation. Rich financial cards and recent messages stay in the same surface through Your picture, Your goals, Your plan, and Review. Manual financial editors are secondary. Existing Home and ongoing planning sessions are unchanged.

Free text uses the existing OpenAI Responses tool loop. Structured output distinguishes exploration, ambiguity, factual updates, and proposed plans. Exploration and clarification cannot introduce new allocations or overwrite uncertain facts in the session. Concrete interpretations update the session without another candidate-approval screen. Only final review, acknowledgment, and **Use this plan** can apply allocations to the canonical workspace. Revisions invalidate the prior approval, preserve history, and recalculate the proposal.

A bill can hold a scheduled full amount and effective date. The existing amount remains in force for bills due before that date. Reserve calculations, projected payments, and liquidity protection resolve the amount by obligation date. “Next month” is relative to the prominently labeled sample date, not the visitor’s real calendar date. Income forecasts never add money to current account balances.

Failed or stopped AI requests preserve conversation and draft and offer retry. They are not represented as successful model responses. Session history and financial cards resume in the current browser tab. OpenAI is identified beneath the composer. This remains a synthetic/manual portfolio demo, not connected banking or evidence of adoption.

## Verification

Focused state/calculation tests cover derived opening values, preference preservation without allocation, ambiguous changes, effective-dated rent, validated persistence, multi-detail proposals, revisions, and exact final approval. Existing purchase and subscription regressions remain. `npm run test:build` passes 248 tests plus six HTTP checks; lint has no errors and two pre-existing warnings.

The deployed live-model suite passed **6/6 turns** on `80fcdf0`: future rent, security plus enjoyment, multi-detail cushion/camera planning, contribution revision, ambiguous income, and clarification. Provider response IDs and output are retained locally in `outputs/evaluations/conversational-onboarding.json`. These are focused synthetic acceptance cases, not a production reliability benchmark.

Public-browser verification exercised fresh findings, future rent, Looks right → motivation, exploratory follow-up, the multi-detail proposal, a revision from $100 to $50, mobile reload with full history, review acknowledgment, and Use this plan → Home. The final plan earmarked $50 for the cushion and $325.26 for the camera, retained Dining at $75, and showed $843.74 available after protected amounts. The current rent remained $1,600; $1,750 starts with bills due from September 1 in the August 1 fixture.

Local production-browser verification separately exercised an actual unavailable-AI response, retry without duplicate user turns, and reload preserving history and confirmed picture. Public production uses the configured live model; no outage was induced there. Browser inspection also identified and corrected the scroll anchor so new cards stay above the sticky composer. Screenshots and local notes are under ignored `outputs/steward-review-assets/`.

`npx tsx scripts/eval-onboarding-conversation.ts <deployment-url>` reruns the focused live suite using the authenticated Vercel CLI.
