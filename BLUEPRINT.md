# Steward — Product & Implementation Blueprint

**Status:** Authoritative. Approved with amendments 2026-08-01.
**Supersedes:** all prior product direction in this repository.

> **The central question**
> *"What do I want my money to accomplish, and what is the best path there from where I am right now?"*
>
> **The everyday promise**
> *"Tell Steward what you want. It will show you how to get there without losing track of where your money is going."*

---

## 0. Framing

```
THE PAYCHECK IS THE RHYTHM.
THE LEDGER IS THE TRUTH.
THE PLAN DIRECTS THIS CYCLE.
THE PATH REPRESENTS WHAT THE USER WANTS.
THE ALLOCATION ENGINE CONNECTS THEM.
AI MAKES THE SYSTEM EASY TO UNDERSTAND AND CONTROL.
```

### The three truths — these must never collapse into one another

| Truth | Question | Where it lives |
|---|---|---|
| **Ledger truth** | What actually happened to my money? | Ledger |
| **Plan truth** | What does this paycheck need to accomplish? | Now + Payday |
| **Path truth** | What am I trying to make happen next? | Path |

Steward's intelligence *connects* the three. It never merges them. A number that
belongs to one truth must never be presented as if it belonged to another.

### The eight questions a user must be able to answer

1. What do I have?
2. What is already spoken for?
3. Where am I spending?
4. What do I have left?
5. What am I currently working toward?
6. When will those things happen?
7. What should this paycheck accomplish?
8. What changes if I make a different choice?

> **Questions 1–4 are never sacrificed in pursuit of 5–8.** That mistake has
> already been made once in this codebase. The budgeting system is not legacy
> functionality underneath the exciting product — it *is* part of the exciting
> product, because it is what gives every recommendation credibility.

### Philosophy

Steward does not optimise for maximum saving, maximum debt payoff, or minimum
spending. It optimises for **intentional progress**.

The user decides what kind of life they are building. Steward makes the
financial consequences visible and helps construct the best realistic path.
Sometimes the right answer is the debt. Sometimes it is the buffer. Sometimes it
is the keyboard. Sometimes it is the trip.

Steward must always know the difference between:

> *"You cannot afford this."*

and

> *"You can afford this, but here is what you're choosing to delay."*

That distinction is the product.

---

## Amendment log

Authoritative changes made after the first approval. These override anything
that contradicts them elsewhere in this document.

| # | Amendment |
|---|---|
| **A1** | **No auto-apply of discretionary allocations.** A payday proposal is never confirmed by inaction. Reserves and obligations may behave automatically; elective allocation across Claims may not. See §C10. |
| **A2** | **Debt percentages are default heuristics, not truth.** The APR bands are a swappable policy object, not engine logic. See §C3.2. |
| **A3** | **Focus bias is a strong preference, not an absolute law.** Parallel funding is permitted when circumstances justify it. See §C4. |
| **A4** | **Explicit Claim creation stays first-class.** Harvesting is the default acquisition path, not the only one. See §B5. |
| **A5** | **No general AI chat in V1.** Contextual intelligence only. See §K. |

---

# A. Product model

Eight objects. Everything the product does maps onto these.

| # | Object | Represents | Visible |
|---|---|---|---|
| 1 | **Account** | An external balance | Yes (settings-level) |
| 2 | **Transaction** | One movement of money — the atom of truth | Yes |
| 3 | **Cycle** | One paycheck period; the planning unit | Yes ("this paycheck") |
| 4 | **Bucket** | A destination for money inside a cycle. Kinds: `spend`, `reserve` | Yes |
| 5 | **Claim** | Something being built toward across cycles | Yes — "what you're working toward" |
| 6 | **Project** | A named group of Claims | Yes, thin |
| 7 | **Allocation** | `(cycle → bucket|claim → amount)`; the audit record | Mostly internal |
| 8 | **Rule** | A remembered categorisation | Barely ("Steward remembers this") |

### Bucket and Claim: two objects, one allocation contract

Both receive money in a cycle, both have planned-vs-actual, both drill to
transactions. They differ because their behaviour differs.

| | `spend` bucket | `reserve` bucket | Claim |
|---|---|---|---|
| Behaviour | Refills each cycle | Accumulates → discharges on due date → repeats | Accumulates → completes |
| Example | Groceries, Dining | Rent, electric, card minimum | Card payoff, cushion, golf net |
| Ranked | No | No — obligations don't compete | **Yes** |
| Arrival date | No | Next due date | **Yes** |
| Lives on | Ledger | Ledger | **Path** |
| Waterfall position | Above the line | Above the line | Below the line |

Claims carry six properties buckets don't. Merging them would put six null
columns on Groceries.

### Concept resolution

| Today | Becomes |
|---|---|
| Bill | Bucket `reserve` — the bill *is* the reserve |
| Budget | Bucket `spend` |
| PaycheckPlan (7 fixed fields) | Deleted; replaced by Allocations |
| Goal | Claim |
| Wishlist item | Claim (`purchase`) |
| Project | Project — a container; holds no money itself |
| Debt account | Account → generates a `reserve` bucket (minimum) and *may* have a Claim (payoff) |
| Savings target | Claim (`fund`) |
| Recommendation / Review | Derived Insight, computed on read; only dismissals persist |
| Memory | Rules + explicit settings |

**Debt splits deliberately.** Minimums are obligations above the line, never
ranked. Extra payoff is a Claim below the line, ranked against everything else.
This is what makes the tradeoff meaningful — the user is never choosing between
a want and defaulting.

**Projects hold no money.** Allocation goes to child Claims; a Project's amount
is the sum of its children. A single un-itemised Claim ("Apartment") converts
into a Project when a second item is added.

---

# B. Claim model

```
Claim
  id, name
  kind          purchase | payoff | fund | commitment
  projectId?
  targetAmount  what completion costs
  fundedAmount  sum of Allocations − withdrawals
  rank          ordinal position among active Claims
  status        active | someday | paused | complete
  horizon       arrival | commitment
  divisible     true | false
  delayCost     none | interest(apr) | deadline(date)
  wantBy?       user's desired date — an INPUT
  perCycle      engine-computed; user may pin
  arrivalDate   engine-computed; NEVER user-set
  protected     funded above discretionary ranking
  pinned        user-fixed allocation, exempt from waterfall reshuffling
  linkedAccountId?, note?, url?
```

### B1. `wantBy` vs `arrivalDate`

The user says when they *want* it. Steward says when they'll *get* it. These are
never the same field. Collapsing them would let the user author fiction and
every date in the product would stop meaning anything.

### B2. Inferred vs visible

| Property | Set by | User sees |
|---|---|---|
| name, targetAmount, wantBy | User / harvested | Yes |
| fundedAmount, perCycle, arrivalDate | Engine | **Yes — the payload** |
| rank | User (drag) | Yes, as position |
| status, pinned | User | Yes |
| kind, horizon, divisible, delayCost, protected | Inferred | **No** — behaviour only |

Six visible fields, eight inferred. Nothing in creation asks about divisibility,
horizon, or delay cost.

### B3. Kind defaults

| Kind | Target | Divisible | Delay cost | Horizon |
|---|---|---|---|---|
| `purchase` | Price | No | None, or deadline if `wantBy` | arrival |
| `payoff` | Balance | Yes | Interest at APR | arrival if ≤12 cycles |
| `fund` | User amount | Yes | Deadline if `wantBy` | arrival or commitment |
| `commitment` | Optional | Yes | None | commitment |

### B4. Commitments

A commitment has **a rate, not a date**. It sits above free capacity, never
enters the ranked tradeoff, and shows a running total with no projection.
Steward will not print a date it cannot defend. Within ~12 cycles of its target
it offers promotion to an arrival.

### B5. Creation — harvest by default, explicit always available *(A4)*

Two equally supported paths.

**Harvested (default).** A "Wait" verdict in *Can I buy this?* offers
*"Save for it — $65/paycheck, yours Sept 7."* One tap creates the Claim with
name, target, kind, and rank inferred. The word "goal" never appears.

**Explicit (first-class).** `+ Add something` is permanent on Path. The user
who already knows what they want simply says it:

- *"I want $5,000 in emergency savings."*
- *"I want this credit card gone."*
- *"I want to save $20,000 for a house."*
- *"I want to finish my apartment."*
- *"I want a golf net."*
- *"I want $10,000 of business runway."*

Both a short structured form (name, amount, optional by-when, optional project)
and natural-language intent capture (§K) produce a Claim **draft** the user
confirms. Neither is a multi-step financial-goal wizard.

### B6. Status

- **active** — ranked and fundable. Capped at **7**.
- **someday** — captured, unfunded, no date, costs nothing. Unlimited.
- **paused** — was active; keeps its funded amount; one tap to resume.
- **complete** — target met; shown on Path for one cycle, then archived.

**Money never leaves a Claim because of a status or rank change.**

---

# C. Allocation engine

Fully deterministic. No model involvement anywhere in this section.

## C1. The waterfall

```
  Expected income this cycle
+ Carry-in                      (liquid cash not already committed)
────────────────────────────
− Reserve buckets due          (bills + debt minimums, pro-rated)
− Spend buckets                (everyday)
− Buffer top-up                (only if below floor)
− Protected commitments
────────────────────────────
= FREE CAPACITY
→ distributed to active Claims (C3)
= Remainder                    → buffer, then next cycle
```

`carryIn = liquidCash − unspentReserves − unspentSpend − bufferFloor`

**Golden fixture:** 2150 − 1388 − 322 − 0 − 0 = **$440 free capacity**.

## C2. Reserve pro-rating — everything depends on this

```
cyclesRemaining   = paydays from today through the due date (min 1)
requiredThisCycle = (amountDue − alreadyReserved) / cyclesRemaining
```

Rent $1,600 due 2026-08-28, paydays on 08-10 and 08-24 → 2 cycles → **$800**.
Displayed as *"Rent — $800 of $1,600 reserved · 1 paycheck to go."*

This is the highest-risk calculation in the product and gets the deepest tests.

## C3. Distributing free capacity

### C3.1 Pass order

1. **Protected floors** — commitments at their rate; starter cushion if the
   buffer is below one cycle of expenses.
2. **Interest-aware suggestion** for `payoff` Claims (C3.2).
3. **Deadlines** — Claims with a `wantBy` take what's required, if feasible.
   If infeasible, Steward states the miss plainly rather than silently slipping.
4. **Pins** — user-pinned amounts are honoured exactly.
5. **Waterfall** — the remainder flows top-down the ranked list.
6. **Concentration preference** (C4).

### C3.2 Debt policy is configuration, not engine logic *(A2)*

The engine consumes an injected policy object. It contains no APR literals.

```ts
type DebtAccelerationPolicy = {
  id: string;                  // versioned, e.g. "apr-bands-v1"
  suggest(input: {
    apr: number;
    balance: number;
    freeCapacity: number;
    userHistory?: PolicySignals;
  }): { amount: number; rationale: string };
};
```

**Initial default (`apr-bands-v1`)** — a starting heuristic, not a law:

| APR | Suggested share of free capacity |
|---|---|
| ≥ 15% | 40% |
| 8–15% | 25% |
| < 8% | 0% |

Required behaviour, independent of policy version:

- Steward **recognises** the cost of high-interest debt.
- Steward **recommends meaningful acceleration**.
- Steward **shows the opportunity cost** of choosing other Claims instead.
- The user **retains final control**, always, in one tap.

> **Steward is not a debt-maximisation machine.** Discretionary dollars do not
> belong to debt by default. The suggestion is a starting position that is
> stated once, with its reason, and never re-argued.

Swapping the policy must require no change to the allocator.

## C4. Concentration — a strong preference, not a law *(A3)*

**Philosophy: "make fewer things happen faster" — not "only one purchase may
ever be funded."**

Retained:
- Active Claims capped at **5–7**
- Waterfall allocation, top-down
- **No token amounts.** An unfunded Claim shows a **start date**, never $5
- A soft target of **≤4 Claims funded per cycle**

Parallel funding is **permitted** when circumstances justify it:
- a `wantBy` deadline requires it
- the user has **pinned** an allocation
- two Claims are both high-priority purchases the user has ranked adjacently
- any other **explicit user intent**

When the allocator exceeds its soft concentration target it says so once:
*"Funding four things this cycle — the keyboard and the net both arrive later
than if you focused on one."* Stated, not enforced.

**Removed:** the absolute rule that only one indivisible purchase may receive
funding at a time. Indivisible Claims still accumulate; the allocator still
*prefers* completing one before starting another; it is no longer forbidden
from doing otherwise.

## C5. Divisible vs indivisible

- **Divisible** (funds, payoffs) accept any amount and absorb remainders.
- **Indivisible** (purchases) accumulate; partially-funded money is inert until
  complete, so the allocator prefers concentration — see C4.
- An indivisible Claim needing >6 cycles at the current rate is flagged **once**:
  *"About 5 months at this rate. Move it up, or park it in Someday?"* No nagging.

## C6. Not enough money

When free capacity ≤ 0, Steward never fails silently and never auto-solves:

1. States the shortfall **and its cause**.
2. Offers exactly three levers, in order: reduce a spend bucket · pause a Claim ·
   dip into buffer.
3. **Never reduces an obligation.**
4. If the buffer is used, schedules and shows the top-up.

## C7. Surplus

Extra income or cycle-end underspend follows the same waterfall and is
**announced, never silent**: *"$180 more than expected — I put it on the card.
Payoff moves to Dec 24."* → **[Redirect]**

Cycle-end unspent spend buckets: per-bucket flag. Discretionary **sweeps** to the
top Claim (a visible win); essentials **roll**. Set at onboarding, never re-asked.

## C8. Reranking

- Affects **future cycles only**; confirmed allocations are immutable.
- Funded amounts always stay with their Claim.
- Dragging recomputes arrival dates **live** and shows a diff:
  *"Card: Jan 7 → Jan 21 · Golf net: Sep 7 → today"* → **[Save] [Revert]**
- Nothing commits until Save.

## C9. New Claims never silently rebalance

Adding a Claim produces a **proposal**, never a mutation. Funding comes from
surplus first; cannibalisation only when surplus is short, always in reverse
rank order so it is predictable. The proposal names every Claim that moves and
by how much.

## C10. Payday proposals are never auto-applied *(A1)*

Steward may **calculate and display** a proposed plan automatically. Reserves,
obligations, and buffer top-ups may execute automatically under established
rules — they are not elective.

**Discretionary allocation across Claims requires explicit confirmation.**

- A proposal remains **pending** until confirmed, modified, or superseded by the
  next cycle's proposal.
- Ignoring the payday flow confirms nothing.
- Unconfirmed free capacity simply remains unallocated and visible as
  *"$440 waiting to be directed."*
- A superseded proposal is discarded, not merged.

> Financial software must not make elective allocation decisions on a user's
> behalf through their inaction.

## C11. Arrival dates

Deterministic forward simulation holding income, reserves, spend budgets,
policy, and ranking constant. Snapped to a real payday.

- **Capped at 12 months.** Beyond: *"more than a year out,"* no date.
- **Every date change is remembered** so Steward can say *"was Jan 7"* — a
  promise made is a promise tracked.
- Interest included for `payoff` Claims from the stored APR. **Missing APR →
  Steward says so and refuses to project.**

---

# D. Screen architecture

```
┌──────────────────────────────────────────┐
│   NOW      [ + Can I buy this ]     PATH │
│                 LEDGER                   │
└──────────────────────────────────────────┘
Avatar → Accounts · Rules · Settings · Export
Payday → full-screen takeover, not a tab
```

| Screen | Purpose | Test |
|---|---|---|
| **NOW** | Am I okay, and am I getting anywhere? | Informed within 8 seconds? |
| **PATH** | What I'm working toward, ordered, with dates | Can I see what I'm choosing and what it costs? |
| **LEDGER** | Where the money actually went | Any transaction behind any number in ≤2 taps? |

*Can I buy this?* is a centre action on every screen — the wedge is never more
than one tap away and never inside a menu.

**Debt is deliberately not a tab.** It appears as progress on Now, a ranked
Claim on Path (with a detail view), and reserve buckets on Ledger. Giving it a
tab would re-isolate the thing the redesign exists to integrate.

**One responsive component tree at both breakpoints.** No parallel mobile and
desktop implementations — that is the structural source of drift.

---

# E. NOW

Reassurance → orientation → progress. Not a dashboard. **It scrolls.**

**Above the fold**

1. **Cycle position** — *"$612 left · 9 days to payday"*, a bar that drains.
   Caption: *"$1,388 reserved for bills · $322 budgeted for everyday."* Tappable
   to the full derivation. *(This replaces "safe to spend": a ledger position the
   user can reconstruct, not a verdict they must trust.)*
2. **At risk** — conditional. Absent when nothing is wrong. Silence is a feature.
3. **Bucket strip** — horizontally scrollable mini-bars, colour-coded, each
   tapping through to Ledger filtered. *This is how budgeting stays visible on
   the most-viewed screen.*
4. **Progress** — *"Card −$178 · payoff Jan 7 · Cushion +$150 · Apartment 62%."*

**Below the fold**

5. **Next up** — next obligation with reserve status.
6. **One insight** — at most one, dismissible, transaction-backed.

**Never here:** net worth · account list · charts · transaction list · a
recommendation queue · greeting header.

---

# F. PATH

**Header** — *"$440 per paycheck is yours to direct"* → derivation.

**Protected** *(collapsed)* — commitments and starter cushion. "On autopilot."

**Active** *(ordered, draggable, max 7)* — name, bar, two numbers, one date:

```
① Card payoff        ████████░░  $1,102 of $2,679
   $250 / paycheck               paid off Jan 7      →
② Cushion            ██░░░░░░░░  $310 of $2,000
   $100 / paycheck               full Apr 2027       →
③ Keyboard           ██████████  $90 of $90
   complete                      ✅ yours today      →
④ Apartment  3 items ███░░░░░░░  $275 of $900
   starts Aug 24                 —                   ⌄
```

Funded and queued rows are visually distinct. Queued rows show a **start date**.

**Someday** *(collapsed)* — unfunded, undated, no guilt. The valve that keeps
Active at 5–7.

**`+ Add something`** — permanent *(A4)*.

**Behaviours** — drag to rerank with live dates and Save/Revert · Projects
expand to children and move as a unit · Debt detail carries balance, APR, *"the
$78 minimum is already handled in your bills,"* payoff date, interest, and the
**scenario control** (*"$350/paycheck → Nov 26, saves $86 and 6 weeks"*).

**Never here:** allocation sliders · scenario tabs · confidence bands · goal
wizards · any date beyond 12 months.

---

# G. LEDGER

**The trust floor. This gets more capable in the redesign, not less.**

> **Traceability contract (enforced by test):** every number displayed in
> Steward is either a single transaction, or the sum of a set of transactions
> and allocations the user can reach in **at most two taps**.

1. **Cycle selector** — this paycheck ▾ (prior cycles, or a month view)
2. **Summary** — in · out · left
3. **Spend buckets — the full traditional budget view**
   ```
   Groceries   $82 of $150    55%  ████████░░░░░░  $68 left
   Dining      $62 of $75     82%  ██████████████  $13 left  ⚠ running hot
   ```
   Planned · spent · remaining · percentage · bar · state colour.
   Tap → the transactions **summing visibly to the number shown**.
4. **Reserves** — accumulation state per obligation
5. **Needs review** — surfaced only when non-empty
6. **All transactions** — a searchable *list*, not a table. No bulk-select
   toolbar, no spreadsheet affordances.

**Correction that learns:** change a category → *"Always put Circle K in
Groceries?"* → creates a **Rule**, visible and deletable. All affected numbers
update immediately.

**Splits:** available from transaction detail; must sum to the total.

---

# H. PAYDAY

The most important recurring moment. Full-screen, dismissible, resumable.
**Target 60–90 seconds. Confirms nothing by default (A1).**

**1 · Arrival** — *"$2,150 landed. Let's put it to work."*

**2 · Already handled** *(automatic — reserves and obligations)*
> Bills & minimums **$1,388** — rent $800 *(half of $1,600, due Aug 28)* ·
> electric $96 · internet $70 · phone $55 · card minimum $78 · auto loan $289
> Everyday **$322** · Buffer **$0** *(at your $400 floor)*
> **$440 is yours to direct.**

**3 · Proposal** *(pending until confirmed)*
```
① Card payoff     $250   →  paid off Jan 7
② Cushion         $100   →  $2,000 by Apr 2027
③ Keyboard         $90   →  ✅ yours today
④ Apartment         $0   →  starts Aug 24
⑤ Golf net          $0   →  starts Sep 7
```
*"$250 on the card because it's 24% — that's the suggested share. Change
anything."*

**4 · Adjust** — drag; dates move live; the diff is stated before saving.
Moving the net above the card surfaces *"Card payoff: Jan 7 → Jan 21, about $22
more interest"* — once, as a fact, with no confirmation dialog.

**5 · Confirm** — explicit. **If the user never confirms, nothing discretionary
is applied.** Now shows *"$440 waiting to be directed"* until they do, or until
the next cycle supersedes it.

---

# I. "CAN I BUY THIS?"

Persistent centre action. Inputs: item · price · *optional* project · *optional*
by-when.

Three verdicts: **Yes · Yes, but · Wait until [date]**. Never a bare "No" —
there is always a *when*, and the *when* is the answer.

```
Logitech keyboard · $90
YES.
✅ Bills through Aug 28 — covered
✅ Buffer — stays at $400
✅ Household bucket — $33 left
✅ Card payoff — still January 7
Costs you: ~$90 less toward the cushion — full Apr 2027 instead of Mar 2027.
[Bought it]  [Not now]
```

```
Golf net · $130
WAIT UNTIL SEPT 7.
✅ Bills covered   ✅ Buffer untouched
⚠️ Buying today takes $130 from the card payment —
   payoff Jan 7 → Jan 21, about $22 more interest
If you want it now: move it up and it's yours today — the keyboard slips to Aug 24.
[Save for it — $65/paycheck, yours Sept 7]  [Buy it anyway]  [Someday]
```

**Harvesting:** the save button creates a Claim in one tap — name, target, kind,
rank all inferred. No form. This is the primary acquisition path for the Claim
graph, and the reason permission remains the wedge.

**"Bought it"** logs the decision and reconciles against the matching
transaction when it arrives.

---

# J. FIRST-RUN

Deliver a real fact before asking for anything. Under two minutes. No wizard.

1. **Promise + connect** — *"Know what you can spend. Know what it costs you."*
   `[Connect your bank]` · *[I'll enter it myself]* — the manual path is
   first-class and Plaid failure never blocks the product.
2. **Basics** *(manual only)* — take-home, frequency, next payday, rent.
3. **THE REVEAL** — the hook:
   > **$440 of every paycheck isn't spoken for.**
   > $2,150 in · −$1,388 rent, bills, minimums · −$322 everyday
   > *Built from your last three months. Change any of it.*
4. **"What should that $440 do?"** — six tappable chips, multi-select, no text
   field. `Not sure yet` is a legitimate answer.
5. **Order them** — pre-ranked by defaults, arrival dates already showing, drag
   to fix.

> **Steward must be fully useful with zero Claims.** Someone who skips step 4
> gets correct buckets, reserves, cycle position, ledger, and debt tracking — a
> genuinely good budgeting app. The Claim system is never a prerequisite for
> value. This is the mitigation for the failure mode that kills goals-first
> products.

Debt Claims are pre-created from connected accounts.

---

# K. AI role *(A5)*

### Four surfaces, all anchored

| Surface | Input | Output | Fallback with no model |
|---|---|---|---|
| **Verdict phrasing** | Computed verdict object | 2–3 human sentences | Deterministic template |
| **Intent capture** | *"I want the Discover gone by spring"* | Claim **draft** for confirmation | The short add form |
| **Pattern noticing** | Ledger over N cycles | Insight + proving transactions | No insight shown |
| **Contextual follow-up** | An on-screen object + question | Explanation from supplied values only | "Here's the calculation" panel |

### Hard rules

1. **The model never computes money.** It receives computed values.
2. **It may not state a number absent from its input.** Every numeral in the
   output is validated against the supplied context; failure → deterministic
   string.
3. **Every AI sentence is backed by a deterministic object** the user can open.
4. **The product is fully functional with the LLM disabled.** Requirement, not
   a nicety.
5. **Insights must point at transactions.** No undrillable pattern is shown.

### No general chat tab in V1

Intelligence appears **where the question exists**, anchored to a specific
object: *Ask about this · Why? · What changed? · What if I move this up? · Why
is this date later? · Where did this number come from? · What happens if I spend
$130 here?*

A general conversational assistant returns only once the financial system and
tool access are mature enough to make it genuinely useful.

> Do not build a chatbot just because this is an AI product.

---

# L. Migration map

**KEEP** — Plaid pipeline (link/exchange/sync/cursor/encryption) · learned
merchant categorisation · Plaid PFC mapping and deterministic fallback rules ·
the debt payoff simulation and its honest refusal on missing terms · the
determinism pattern itself · the desktop visual system · empty first-run ·
workspace persistence, audit, export, delete.

**MODIFY** — `calculateTradeoffs` → the full waterfall (all obligations, loan
minimums, carry-in) · `paycheckBuckets` → Bucket/Claim split with reserve
pro-rating (the four groups survive as display grouping) · `paycheckAllocation`
→ free capacity + ranked allocator · `debtPayoffPlan` → scenario diffing and
arrival dates · `suggestBudgets` → seeds spend buckets at onboarding · advisor
route → verdict phrasing + intent capture · net position (loans as debt) ·
wishlist status recomputed per cycle rather than frozen at creation.

**MERGE** — Goals + Projects + Wishlist → Claims/Projects · Bills + Budgets +
PaycheckPlan → Buckets · Recommendations + Reviews → derived Insights ·
Memories → Rules · **desktop and mobile component trees → one responsive tree.**

**REMOVE** — `paycheckPlan`'s seven fixed fields · the two competing Plan tabs ·
Reviews screen · Advisor tab · AI-memory settings · notification preferences UI ·
global search · the four-metric grid · transactions-as-table with bulk
checkboxes · dead buttons · the mobile More sheet · `riskTolerance`,
`budgetingStyle` · investment prominence · copy-string tests.

**ADD** — Claim, Project, Allocation, Rule · reserve pro-rating · free-capacity
waterfall · arrival projector · ranking + waterfall allocator · debt policy
object · concentration preference · Someday · commitment horizon · promise
tracking · payday flow (pending-by-default) · Can-I-buy-this · bucket→transaction
drilldown · split UI · progress deltas · scenario control · one responsive tree ·
engine invariant tests + golden fixture.

---

# M. V1 scope

**Hypothesis under test:** *do people reorder the list and react to the dates?*

**In** — Accounts (Plaid + manual) · Transactions with categorisation,
correction, rules, splits · Cycles · the waterfall with reserve pro-rating ·
buffer · spend buckets with full budget display · reserve buckets · bucket
drilldown · needs-review · Claims (all four kinds) · Projects · ranking ·
allocator with concentration preference and swappable debt policy · arrival
dates · Someday · pause · promise tracking · debt minimums as obligations,
payoff as Claim, payoff date, interest, scenario control · Payday (pending by
default) · Can I buy this · Now with progress · Now/Path/Ledger · onboarding ·
accounts/rules/settings · verdict phrasing · intent capture · one insight/day ·
traceability · export · delete.

**Wait** — general chat · projections beyond 12 months · investments and net
worth · project task lists · automated subscription detection *(collect data
now)* · weekly/monthly reviews · notifications beyond payday and at-risk ·
household sharing · scenario planning beyond the debt control · receipts ·
billing · the Path timeline visualisation · CSV import · email/push.

---

# N. Implementation sequence

## Phase 0 — Safety net *(complete; see `baseline/RESTORE.md`)*

## Phases in dependency order

1. **Domain model + reversible converter.** New objects alongside the old shape.
   *Gate: round-trips the golden fixture exactly.*
2. **The deterministic engine.** Reserve pro-rating · waterfall · free capacity ·
   ranked allocator · concentration preference · debt policy object · arrival
   projector · scenario diff. Pure functions, no UI.
   *Gate: produces `TARGET_V1` exactly, plus adversarial cases — zero income,
   negative capacity, missing APR, bill due today, five-payday months, paused
   mid-cycle, unconfirmed proposal superseded.* **Replace copy-string tests here.**
3. **Ledger.** Built first among screens — the trust floor, closest to what works.
   *Gate: every number reaches its transactions in ≤2 taps, automated.*
4. **Now.**
5. **Path.** *Gate: reorder → dates move → save/revert; funded amounts never change.*
6. **Payday.** *Gate: an ignored proposal applies nothing discretionary.*
7. **Can I buy this** — including one-tap harvesting.
8. **AI layer.** Last, so every surface already has a deterministic fallback.
   *Gate: full acceptance passes with the model disabled.*
9. **Onboarding.**
10. **Cleanup.** Retire the old IA, delete duplicate trees, single responsive
    tree, final screenshot comparison. `/legacy` is removed here, in one
    deliberate commit.

## Standing rules

- **Engine before UI, always.**
- **One component tree.** No new desktop/mobile forks.
- **No number renders without a traceability path.**
- **`/legacy` stays reachable until Phase 9 signs off.**
- **Every phase re-runs the golden fixture and diffs screenshots against
  `baseline/screenshots/`.**
- **No conceptual redesign** unless implementation exposes a genuine
  contradiction in this model.
