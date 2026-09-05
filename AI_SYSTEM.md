# Steward AI behavior — September 5, 2026

Arithmetic, verdicts, dates, target IDs, and state changes belong to deterministic
code. The primary onboarding review and Ask purchase follow-ups require no model.
Ask keeps the most recent purchase or goal context, replaces superseded proposals,
and retains deadlines through amount corrections; numeric replies and cancellation are resolved
before generic intent extraction. A proposed new goal needs an explicit Apply.
Critical affordability wording uses the structured verdict directly, including
current-liquidity uncertainty. It is never entrusted to numeric-only prose guards.

Optional intent interpretation and receipt classification remain behind the server
AI routes. Legacy conversational onboarding is retained but is no longer the
primary setup path. Successful deterministic fallbacks are not retried merely
because they were not model-enhanced. Cross-host automatic AI forwarding was removed.

`STEWARD_AI_ENABLED=true` plus a server-only key is required for paid generation.
Default behavior is deterministic/fallback. Request bodies, receipt media types,
output categories, output tokens, concurrency and per-process daily calls are
bounded. A shared gateway budget is an outstanding production dependency.
Receipt output is a draft; split totals must reconcile before saving.

## Evaluation evidence

`tests/model-evaluation-cases.json` contains representative utterances, expected
entities/amounts/allowed mutations, and forbidden claims, including malicious text
inside merchant data. Deterministic conversation, liquidity, proposal and grounding
checks run in the unit suite; HTTP checks verify the actual fallback route.

**No live-model evaluation was run in this implementation.** Paid generation is
operator-gated and remained disabled for verification. Do not report schema/unit
or HTTP fallback tests as model-quality evaluations. A baseline comparison and
human assessment of optional generated explanations remain required before
turning public generation on. No claim is made about measured model accuracy.

Check-in preferences are not scheduled notifications. There is no email, push,
SMS or periodic check-in delivery mechanism in this release.
