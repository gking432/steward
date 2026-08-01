# AI system

Steward follows a strict calculation/explanation split.

## Deterministic layer

`lib/engine.ts` owns:

- available cash after obligations and reserves
- financial-health classification
- primary financial-bottleneck detection
- one daily decision
- BUY / WAIT / DO NOT BUY affordability decisions
- bills before payday
- required debt coverage
- paycheck reconciliation
- risk classification
- category aggregation
- deterministic merchant rules
- transaction split validation

These results work offline and are covered by automated tests.

## OpenAI layer

`lib/openai-service.ts` uses the Responses API only when `OPENAI_API_KEY` exists.
It receives:

- the user’s question
- a deterministic answer that it may not contradict
- a bounded financial context
- structured goals and wishlist summaries

It returns structured `answer`, `rationale`, and `assumptions` fields. The model
is instructed to behave like a financial chief of staff: explain what happened,
why it matters, what to do next, the tradeoffs, and the strongest alternative.
Requests use `store: false`.

Financial record strings are treated as untrusted data. The developer prompt
explicitly prohibits following instructions embedded in merchant names, notes,
or wishlist text.

## Memory

Memory is structured into preference, rule, priority, and context records. Users
can view and delete individual memories. Conversation transcripts are not used
as implicit long-term memory.

## Future

- Server-side advisor tools with explicit read/write authorization
- Confirmation gates for any mutation proposed in chat
- Evaluation sets for affordability, missing-data honesty, and tone
- Rate limits, abuse monitoring, and safety identifiers
- Optional embeddings only for durable semantic records that cannot be handled
  with structured lookup
