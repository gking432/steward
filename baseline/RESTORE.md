# Baseline & Restore

The pre-redesign Steward application is preserved here. Nothing in the redesign
may remove or modify it.

## Restore points

| Ref | Location | Commit | Notes |
|---|---|---|---|
| `baseline/pre-redesign` | **remote + local** | `00e1eb0` | Primary restore point |
| `main` | **remote + local** | `00e1eb0` | Independent second pointer |
| `v0-baseline` (annotated tag) | **local only** | `00e1eb0` | See limitation below |

All three point at the identical tree. `00e1eb0` is the last commit before any
redesign work.

> **Known limitation:** the git proxy in the current environment accepts branch
> pushes but rejects `refs/tags/*` (`send-pack: unexpected disconnect`). The
> `v0-baseline` tag therefore exists locally but is **not** on the remote.
> Durable protection comes from the two remote *branches*, which are equivalent
> restore points. `baseline/pre-redesign` must never be committed to.

## How to restore

**Inspect the old application without changing anything:**
```bash
git switch --detach baseline/pre-redesign
npm install && npm run dev
```

**Fully revert the working branch to the pre-redesign application:**
```bash
git checkout redesign
git reset --hard baseline/pre-redesign
```

**Recreate the tag on a machine whose remote accepts tags:**
```bash
git tag -a v0-baseline 00e1eb0 -m "Immutable baseline"
git push origin refs/tags/v0-baseline
```

## Running application preserved in place

The pre-redesign experience also stays reachable **inside the running app** for
the whole redesign, so `/` can be replaced without ever losing access to it:

| Route | Serves |
|---|---|
| `/` | The application under redesign |
| `/legacy` | The pre-redesign application, with full workspace persistence |
| `/fixture` | The golden fixture, server sync disabled — the visual-regression harness |

`/legacy` is removed only at Phase 10, in a single deliberate commit, after the
new experience reaches parity.

## Golden fixture

`fixtures/golden-workspace.ts` — the canonical test user. Deterministic, fixed
dates anchored to `FIXTURE_TODAY = 2026-08-01`. Never make these values relative
to `new Date()`.

`fixtures/golden-expectations.ts` — two blocks:

- **`BASELINE_V0`** — what the pre-redesign engine actually produced, measured
  on 2026-08-01. A record of fact, including the defects the redesign exists to
  fix. Do not "correct" it.
- **`TARGET_V1`** — the contract Phase 2 must satisfy, derived by hand in
  `BLUEPRINT.md` §C.

### Measured baseline vs target

| | Baseline (v0) | Target (v1) |
|---|---|---|
| Rent reserved this cycle | **$0** | **$800** |
| Obligations recognised | $221 | $1,388 |
| Loan minimum counted | **No** | Yes |
| Headline "available" figure | $1,041 safe-to-spend | $440 free capacity |
| Plan tab A unassigned | $1,294 | — |
| Plan tab B unassigned | $490 | — |
| Disagreement between the two | **$804** | **$0** (one model) |

## Screenshots

`baseline/screenshots/` — 21 images of the pre-redesign application, captured
from `/fixture` at 390×844 (mobile, 2×) and 1440×900 (desktop, 2×, full page),
plus the empty-state connect gate.

Because they are rendered from committed deterministic data, later phases can be
compared against them directly.

Recapture with:
```bash
npm run dev
node scripts/capture-screenshots.mjs   # added in Phase 1
```

## Branch structure

```
main                       00e1eb0   untouched
baseline/pre-redesign      00e1eb0   restore point — never commit here
redesign                             integration branch for the rebuild
claude/steward-vision-audit-xf1z4d   working branch, tracks redesign
```
