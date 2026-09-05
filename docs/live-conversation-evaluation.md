# Live conversation evaluation — September 5, 2026

Actual OpenAI Responses API calls on a Vercel candidate returned model-origin
results for all nine scripted turns. Model: `gpt-5.6-sol`. Provider latency ranged
from 1.4 to 4.0 seconds in this run; this excludes CLI/network overhead.

| Case | Result |
|---|---|
| Open-ended cushion; no extra debt | Pass |
| Add camera without losing cushion | Pass |
| Correct camera amount | Pass |
| Put camera before cushion | Pass |
| Cancel camera and retain cushion | Pass |
| Ask about groceries without a price | Pass |
| Reply 50; engine says yes with no goal delay | Pass |
| Switch from groceries to camera | Pass |
| Correct camera without restoring grocery topic | Pass |

Run `npx tsx scripts/eval-conversation.ts DEPLOYMENT_URL` with the configured Vercel
CLI to reproduce. Machine-readable inputs, outputs, model response IDs, token
usage, and latency are in `outputs/live-conversation-evaluation.json` locally.

This is one small functional evaluation of synthetic conversations. It does not
establish broad accuracy, prompt-injection robustness, production financial
readiness, user adoption, or sustained performance under load. Calculations and
confirmation boundaries are separately covered by deterministic tests.
