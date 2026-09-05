# Conversational onboarding correction

The sample and manual onboarding entry now use one persistent conversation. A synthetic-account summary is calculated on entry; it is not described as a live model response. “Looks right” confirms the starting picture and opens the motivation conversation. Rich financial cards and recent messages stay in the same surface through Your picture, Your goals, Your plan, and Review. Manual financial editors are secondary. Existing Home and ongoing planning sessions are unchanged.

Free text uses the existing OpenAI Responses tool loop. Structured output distinguishes exploration, ambiguity, factual updates, and proposed plans. Exploration and clarification cannot introduce new allocations or overwrite uncertain facts in the session. Concrete interpretations update the session without another candidate-approval screen. Only final review, acknowledgment, and **Use this plan** can apply allocations to the canonical workspace. Revisions invalidate the prior approval, preserve history, and recalculate the proposal.

A bill can hold a scheduled full amount and effective date. The existing amount remains in force for bills due before that date. Reserve calculations, projected payments, and liquidity protection resolve the amount by obligation date. “Next month” is relative to the prominently labeled sample date, not the visitor’s real calendar date. Income forecasts never add money to current account balances.

Failed or stopped AI requests preserve conversation and draft and offer retry. They are not represented as successful model responses. Session history and financial cards resume in the current browser tab. OpenAI is identified beneath the composer. This remains a synthetic/manual portfolio demo, not connected banking or evidence of adoption.

## Verification

Focused state/calculation tests cover derived opening values, preference preservation without allocation, ambiguous changes, effective-dated rent, validated persistence, multi-detail proposals, revisions, and exact final approval. Existing purchase and subscription regressions remain. `npm run test:build` passes 248 tests plus six HTTP checks; lint has no errors and two pre-existing warnings.

Live acceptance and public-browser verification are recorded after deployment; `scripts/eval-onboarding-conversation.ts` exercises the actual server-side model with fictional data and keeps local evidence under ignored `outputs/evaluations/`.
