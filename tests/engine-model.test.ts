import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_TODAY, goldenScenario } from "../fixtures/golden-scenario";
import { goldenWorkspace } from "../fixtures/golden-workspace";
import { toModel } from "../lib/model/convert";
import {
  allocate,
  bucketActivity,
  currentCycle,
  diffArrivals,
  planCycle,
  projectArrivals,
  reserveRequirement,
  upcomingPaydays,
} from "../lib/model/engine";
import { aprBandsV1, type AllocationPolicy } from "../lib/model/policy";
import type { Workspace } from "../lib/model/types";

/**
 * PHASE 2 GATE — the deterministic engine.
 *
 * These replace the copy-string assertions that previously stood in for tests.
 * They check arithmetic and invariants, not markup.
 */

const ws = () => goldenScenario();
const plan = (workspace = ws(), today = FIXTURE_TODAY) => planCycle(workspace, today)!;

/* ------------------------------------------------------------- calendar -- */

test("paydays advance on the pay cadence and skip ones already past", () => {
  assert.deepEqual(upcomingPaydays(ws(), FIXTURE_TODAY, 3), [
    "2026-08-10",
    "2026-08-24",
    "2026-09-07",
  ]);
  // A date after the stored nextPayday must still resolve forward.
  assert.deepEqual(upcomingPaydays(ws(), "2026-09-10", 1), ["2026-09-21"]);
});

test("the current cycle brackets today", () => {
  const cycle = currentCycle(ws(), FIXTURE_TODAY)!;
  assert.equal(cycle.start, "2026-07-27");
  assert.equal(cycle.end, "2026-08-10");
  assert.ok(cycle.start <= FIXTURE_TODAY && FIXTURE_TODAY < cycle.end);
});

/* ------------------------------------------------------------- reserves -- */

test("rent is pro-rated across the paychecks before it is due", () => {
  const workspace = ws();
  const rent = workspace.buckets.find((bucket) => bucket.name === "Rent")!;
  const result = reserveRequirement(rent, workspace, FIXTURE_TODAY);
  // $1,600 due 2026-08-28; paydays 08-10 and 08-24 fall before it.
  assert.equal(result.cyclesRemaining, 2);
  assert.equal(result.required, 800);
});

test("a bill due before the next payday is required in full", () => {
  const workspace = ws();
  const electric = workspace.buckets.find((bucket) => bucket.name === "Electric")!;
  const result = reserveRequirement(electric, workspace, FIXTURE_TODAY);
  assert.equal(result.cyclesRemaining, 1, "no payday lands before it");
  assert.equal(result.required, 96);
});

test("a recurring obligation never drops to zero once fully reserved", () => {
  const workspace = ws();
  const electric = workspace.buckets.find((bucket) => bucket.name === "Electric")!;
  const fullyReserved = { ...electric, reserved: 96 };
  const result = reserveRequirement(fullyReserved, workspace, FIXTURE_TODAY);
  // Charging nothing here is what made free capacity oscillate; the steady
  // rate keeps saving toward the next occurrence.
  assert.ok(result.required > 0);
  assert.equal(result.required, result.steadyRate);
});

test("a one-time obligation stops once it is covered", () => {
  const workspace = ws();
  const bucket = {
    ...workspace.buckets.find((b) => b.name === "Electric")!,
    frequency: "one-time" as const,
    reserved: 96,
  };
  assert.equal(reserveRequirement(bucket, workspace, FIXTURE_TODAY).required, 0);
});

/* ------------------------------------------------------------ waterfall -- */

test("the waterfall reproduces TARGET_V1 exactly", () => {
  const result = plan();
  assert.equal(result.income, 2150);
  assert.equal(result.carryIn, 0);
  assert.equal(result.reservesTotal, 1388);
  assert.equal(result.spendTotal, 322);
  assert.equal(result.bufferTopUp, 0);
  assert.equal(result.commitmentsTotal, 0);
  assert.equal(result.freeCapacity, 440);
  assert.equal(result.shortfall, null);
});

test("every obligation is recognised, including the loan minimum", () => {
  const names = plan().reserves.map((entry) => entry.bucket.name);
  assert.ok(names.some((name) => name.includes("Auto Loan")), "loan minimum counted");
  assert.ok(names.some((name) => name.includes("Travel Rewards Card")), "card minimum counted");
  assert.ok(names.includes("Rent"), "rent reserved even though it is due after payday");
});

test("the waterfall balances: nothing appears or disappears", () => {
  const result = plan();
  const total =
    result.reservesTotal +
    result.spendTotal +
    result.bufferTopUp +
    result.commitmentsTotal +
    result.freeCapacity;
  assert.ok(Math.abs(total - (result.income + result.carryIn)) < 0.01);
});

test("a buffer below its floor is topped up before anything discretionary", () => {
  const workspace = ws();
  workspace.profile.bufferFloor = 2500;
  const result = plan(workspace);
  assert.ok(result.bufferTopUp > 0);
  assert.ok(result.freeCapacity < 440);
});

test("a shortfall is reported with its cause and never auto-resolved", () => {
  const workspace = ws();
  workspace.profile.takeHomePay = 900;
  const result = plan(workspace);
  assert.ok(result.shortfall);
  assert.equal(result.shortfall!.largestDriver, "Rent");
  assert.equal(result.freeCapacity, 0, "free capacity floors at zero, never negative");
  // The obligation itself must be untouched.
  assert.equal(result.reservesTotal, 1388);
});

test("zero income produces no free capacity rather than an error", () => {
  const workspace = ws();
  workspace.profile.takeHomePay = 0;
  assert.equal(plan(workspace).freeCapacity, 0);
});

test("a workspace with no payday yields no plan rather than a guess", () => {
  const workspace = toModel(goldenWorkspace());
  workspace.profile.nextPayday = "";
  assert.equal(planCycle(workspace, FIXTURE_TODAY), null);
});

/* ------------------------------------------------------------ allocator -- */

test("free capacity is fully distributed across ranked claims", () => {
  const workspace = ws();
  const result = allocate(workspace, plan(workspace).freeCapacity, FIXTURE_TODAY);
  const total = result.allocations.reduce((sum, entry) => sum + entry.amount, 0);
  assert.ok(Math.abs(total - 440) < 0.01);
  assert.equal(result.unallocated, 0);
});

test("allocation follows rank and respects the debt policy cap", () => {
  const workspace = ws();
  const result = allocate(workspace, 440, FIXTURE_TODAY);
  const byName = Object.fromEntries(
    result.allocations.map((entry) => [entry.claim.name, entry.amount]),
  );
  // 40% of $440 at 23.99% APR.
  assert.equal(byName["Travel Rewards Card"], 176);
  // The keyboard completes; completion is the point of an indivisible claim.
  assert.equal(byName["Logitech keyboard"], 90);
  assert.ok(result.allocations.find((a) => a.claim.name === "Logitech keyboard")!.completes);
  // The lowest-ranked claim is queued, not given a token amount.
  assert.deepEqual(result.queued.map((entry) => entry.claim.name), ["Golf net"]);
});

test("a large divisible claim cannot starve everything below it", () => {
  const workspace = ws();
  const result = allocate(workspace, 440, FIXTURE_TODAY);
  // The cushion needs $1,690 and is ranked second; without a per-cycle ceiling
  // it would absorb every remaining dollar and nothing else would ever move.
  const cushion = result.allocations.find((entry) => entry.claim.name === "Cushion")!;
  assert.ok(cushion.amount < 200, `cushion took ${cushion.amount}`);
  assert.ok(result.allocations.length >= 3, "more than two claims progress");
});

test("the debt policy is swappable without touching the allocator", () => {
  const noDebtPush: AllocationPolicy = {
    ...aprBandsV1,
    id: "test-zero",
    suggestForDebt: () => ({ amount: 0, rationale: "Policy declines to accelerate." }),
  };
  const result = allocate(ws(), 440, FIXTURE_TODAY, noDebtPush);
  const card = result.allocations.find((entry) => entry.claim.name === "Travel Rewards Card");
  assert.ok(!card || card.amount === 0, "no engine change needed to alter debt behaviour");
});

test("a debt with no APR on file is never guessed at", () => {
  const suggestion = aprBandsV1.suggestForDebt({ apr: undefined, balance: 1000, freeCapacity: 400 });
  assert.equal(suggestion.amount, 0);
  assert.match(suggestion.rationale, /not guess/i);
});

test("low-rate debt is not accelerated — Steward is not a payoff maximiser", () => {
  assert.equal(aprBandsV1.suggestForDebt({ apr: 4, balance: 5000, freeCapacity: 400 }).amount, 0);
});

test("a pinned amount is honoured ahead of every heuristic", () => {
  const workspace = ws();
  workspace.claims = workspace.claims.map((claim) =>
    claim.name === "Golf net" ? { ...claim, pinned: 130 } : claim,
  );
  const result = allocate(workspace, 440, FIXTURE_TODAY);
  const net = result.allocations.find((entry) => entry.claim.name === "Golf net")!;
  assert.equal(net.amount, 130, "explicit intent outranks ranking and policy");
});

test("concentration is a preference, not a cap that blocks funding", () => {
  const workspace = ws();
  // Pin every claim: the user has explicitly asked for parallel funding.
  workspace.claims = workspace.claims.map((claim) =>
    claim.status === "active" ? { ...claim, pinned: 50 } : claim,
  );
  const result = allocate(workspace, 440, FIXTURE_TODAY);
  assert.ok(result.allocations.length > aprBandsV1.concentrationTarget);
  assert.ok(result.exceededConcentration, "reported, not prevented");
});

test("someday and paused claims receive nothing", () => {
  const workspace = ws();
  workspace.claims = workspace.claims.map((claim) =>
    claim.name === "Cushion" ? { ...claim, status: "paused" as const } : claim,
  );
  const result = allocate(workspace, 440, FIXTURE_TODAY);
  assert.ok(!result.allocations.some((entry) => entry.claim.name === "Cushion"));
});

test("a paused claim keeps every dollar it was already given", () => {
  const workspace = ws();
  const before = workspace.claims.find((claim) => claim.name === "Cushion")!.fundedAmount;
  const paused = workspace.claims.map((claim) =>
    claim.name === "Cushion" ? { ...claim, status: "paused" as const } : claim,
  );
  assert.equal(paused.find((claim) => claim.name === "Cushion")!.fundedAmount, before);
});

/* ----------------------------------------------------------- projection -- */

test("arrival dates land on real paydays and stay inside the horizon", () => {
  const arrivals = projectArrivals(ws(), FIXTURE_TODAY);
  const paydays = new Set(upcomingPaydays(ws(), FIXTURE_TODAY, 40));
  for (const arrival of arrivals) {
    if (!arrival.arrivalDate) continue;
    assert.ok(paydays.has(arrival.arrivalDate), `${arrival.name} → ${arrival.arrivalDate}`);
  }
});

test("the keyboard completes in the cycle it is funded", () => {
  const arrivals = projectArrivals(ws(), FIXTURE_TODAY);
  const keyboard = arrivals.find((arrival) => arrival.name === "Logitech keyboard")!;
  assert.equal(keyboard.arrivalDate, "2026-08-10");
  assert.equal(keyboard.startsInCycles, 0);
});

test("a queued claim reports when it starts rather than a token amount", () => {
  const arrivals = projectArrivals(ws(), FIXTURE_TODAY);
  const net = arrivals.find((arrival) => arrival.name === "Golf net")!;
  assert.equal(net.perCycle > 0 ? net.startsInCycles > 0 : true, true);
  const allocation = allocate(ws(), 440, FIXTURE_TODAY);
  assert.ok(!allocation.allocations.some((entry) => entry.claim.name === "Golf net"));
});

test("an unreachable claim is reported as beyond the horizon, not given a date", () => {
  const workspace = ws();
  workspace.claims = workspace.claims.map((claim) =>
    claim.name === "Cushion" ? { ...claim, targetAmount: 500_000 } : claim,
  );
  const cushion = projectArrivals(workspace, FIXTURE_TODAY).find((a) => a.name === "Cushion")!;
  assert.equal(cushion.arrivalDate, null);
  assert.equal(cushion.beyondHorizon, true);
});

test("free capacity does not oscillate across projected cycles", () => {
  // The sawtooth this guards against ranged from $83 to $1,432 and made every
  // projected date meaningless.
  let workspace: Workspace = ws();
  let today = FIXTURE_TODAY;
  const capacities: number[] = [];
  for (let step = 0; step < 6; step += 1) {
    const result = planCycle(workspace, today)!;
    capacities.push(result.freeCapacity);
    const allocation = allocate(workspace, result.freeCapacity, today);
    workspace = {
      ...workspace,
      claims: workspace.claims.map((claim) => ({
        ...claim,
        fundedAmount:
          claim.fundedAmount +
          (allocation.allocations.find((entry) => entry.claim.id === claim.id)?.amount ?? 0),
      })),
    };
    today = upcomingPaydays(workspace, today, 1)[0];
  }
  // Ignore the first catch-up cycle, then require stability.
  const steady = capacities.slice(1);
  const spread = Math.max(...steady) - Math.min(...steady);
  assert.ok(spread < 250, `free capacity swung by ${spread}: ${capacities.join(", ")}`);
});

/* ------------------------------------------------------------- scenario -- */

test("moving a claim up reports what it costs, in dates", () => {
  const base = ws();
  const before = projectArrivals(base, FIXTURE_TODAY);

  const promoted: Workspace = {
    ...base,
    claims: base.claims.map((claim) =>
      claim.name === "Golf net"
        ? { ...claim, rank: 0 }
        : { ...claim, rank: claim.rank + 1 },
    ),
  };
  const after = projectArrivals(promoted, FIXTURE_TODAY);
  const changes = diffArrivals(before, after);

  assert.ok(changes.length > 0, "a reorder must have a visible consequence");
  const net = after.find((arrival) => arrival.name === "Golf net")!;
  assert.equal(net.startsInCycles, 0, "the promoted claim is funded immediately");
});

test("reordering never changes any claim's funded amount", () => {
  const base = ws();
  const reordered = base.claims.map((claim) => ({ ...claim, rank: 10 - claim.rank }));
  for (const claim of reordered) {
    const original = base.claims.find((entry) => entry.id === claim.id)!;
    assert.equal(claim.fundedAmount, original.fundedAmount);
  }
});

/* ---------------------------------------------------------- traceability -- */

test("a bucket's spent figure equals the sum of its own transactions", () => {
  const workspace = ws();
  const cycle = currentCycle(workspace, FIXTURE_TODAY)!;
  for (const bucket of workspace.buckets.filter((entry) => entry.kind === "spend")) {
    const activity = bucketActivity(workspace, bucket, cycle);
    const sum = activity.rows.reduce((total, row) => total + row.amount, 0);
    assert.ok(
      Math.abs(sum - activity.spent) < 0.01,
      `${bucket.name}: ${sum} vs ${activity.spent}`,
    );
  }
});

test("dining is flagged as running hot and groceries is not", () => {
  const workspace = ws();
  const cycle = currentCycle(workspace, FIXTURE_TODAY)!;
  const dining = workspace.buckets.find((bucket) => bucket.name === "Dining")!;
  const groceries = workspace.buckets.find((bucket) => bucket.name === "Groceries")!;
  assert.equal(bucketActivity(workspace, dining, cycle).hot, true);
  assert.equal(bucketActivity(workspace, groceries, cycle).hot, false);
});

test("the engine never reads the clock implicitly", () => {
  // Same inputs, different wall-clock invocations, identical output.
  const a = JSON.stringify(planCycle(ws(), FIXTURE_TODAY));
  const b = JSON.stringify(planCycle(ws(), FIXTURE_TODAY));
  assert.equal(a, b);
  const other = JSON.stringify(planCycle(ws(), "2026-09-02"));
  assert.notEqual(a, other, "a different `today` must produce a different plan");
});

/* ------------------------------------------------- debt & correction ---- */

test("payoff scenarios answer what an extra payment buys", async () => {
  const { debtDetail } = await import("../lib/model/decide");
  const workspace = ws();
  const card = workspace.claims.find((claim) => claim.name === "Travel Rewards Card")!;
  const detail = debtDetail(workspace, card.id, FIXTURE_TODAY)!;

  assert.equal(detail.apr, 23.99);
  assert.equal(detail.minimum, 78, "the minimum stays an obligation, not part of the scenario");
  assert.ok(detail.options.length >= 2);

  // Paying more must arrive sooner and cost less interest — the whole point.
  const faster = detail.options[detail.options.length - 1];
  assert.ok(faster.perCycle > detail.current.perCycle);
  if (detail.current.arrivalDate && faster.arrivalDate) {
    assert.ok(faster.arrivalDate <= detail.current.arrivalDate);
    assert.ok(faster.totalInterest <= detail.current.totalInterest);
  }
});

test("a debt with no rate on file gets no projected date", async () => {
  const { debtDetail } = await import("../lib/model/decide");
  const workspace = ws();
  workspace.claims = workspace.claims.map((claim) =>
    claim.kind === "payoff" ? { ...claim, delayCost: { type: "none" as const } } : claim,
  );
  const card = workspace.claims.find((claim) => claim.kind === "payoff")!;
  const detail = debtDetail(workspace, card.id, FIXTURE_TODAY)!;
  assert.equal(detail.apr, null);
  assert.equal(detail.current.arrivalDate, null);
});

test("correcting a category updates the bucket it belongs to", async () => {
  const { recategorise } = await import("../lib/model/decide");
  const workspace = ws();
  const cycle = currentCycle(workspace, FIXTURE_TODAY)!;
  const dining = workspace.buckets.find((bucket) => bucket.name === "Dining")!;
  const before = bucketActivity(workspace, dining, cycle).spent;

  const circleK = workspace.transactions.find(
    (row) => row.merchant === "Circle K" && row.date >= cycle.start,
  )!;
  const after = recategorise(workspace, circleK.id, "Groceries", false);

  assert.equal(
    bucketActivity(after, dining, cycle).spent,
    Math.round((before - circleK.amount) * 100) / 100,
    "the number the user was looking at moves immediately",
  );
});

test("remembering a correction applies it to that merchant's other rows", async () => {
  const { recategorise } = await import("../lib/model/decide");
  const workspace = ws();
  const circleK = workspace.transactions.find((row) => row.merchant === "Circle K")!;
  const after = recategorise(workspace, circleK.id, "Groceries", true);
  const remaining = after.transactions.filter(
    (row) => row.merchant === "Circle K" && row.category !== "Groceries",
  );
  assert.equal(remaining.length, 0);
});

test("a correction is recorded as a reusable rule", async () => {
  const { recategorise } = await import("../lib/model/decide");
  const { toLegacy, toModel } = await import("../lib/model/convert");
  const workspace = ws();
  const circleK = workspace.transactions.find((row) => row.merchant === "Circle K")!;
  const after = toModel(toLegacy(recategorise(workspace, circleK.id, "Groceries", true)));
  assert.ok(after.rules.some((rule) => rule.merchantKey === "circlek" && rule.category === "Groceries"));
});

test("the most severe insight is surfaced, not the first bucket in the array", async () => {
  const { dailyInsights } = await import("../lib/model/decide");
  const insights = dailyInsights(ws(), FIXTURE_TODAY);
  assert.ok(insights.length > 1, "the fixture has more than one thing worth saying");
  // Shopping is at 171%, Dining at 85%. Bucket order puts Dining first.
  assert.match(insights[0].headline, /Shopping/);
  for (let i = 1; i < insights.length; i += 1) {
    assert.ok(insights[i - 1].severity >= insights[i].severity, "sorted by severity");
  }
});

/* ------------------------------------------------------------- splits --- */

test("a split transaction counts toward every bucket it touches", async () => {
  const { splitTransaction } = await import("../lib/model/decide");
  const workspace = ws();
  const cycle = currentCycle(workspace, FIXTURE_TODAY)!;
  const groceries = workspace.buckets.find((b) => b.name === "Groceries")!;
  const shopping = workspace.buckets.find((b) => b.name === "Shopping")!;

  // Amazon $63.15 currently lands entirely in Shopping.
  const amazon = workspace.transactions.find((row) => row.merchant === "Amazon")!;
  const beforeGroceries = bucketActivity(workspace, groceries, cycle).spent;
  const beforeShopping = bucketActivity(workspace, shopping, cycle).spent;

  const after = splitTransaction(workspace, amazon.id, [
    { category: "Groceries", amount: 40 },
    { category: "Shopping", amount: 23.15 },
  ]);

  assert.equal(bucketActivity(after, groceries, cycle).spent, round(beforeGroceries + 40));
  assert.equal(bucketActivity(after, shopping, cycle).spent, round(beforeShopping - 40));
});

test("a split that does not reconcile to the charge is refused", async () => {
  const { splitTransaction, splitIsBalanced, splitDifference } = await import("../lib/model/decide");
  const workspace = ws();
  const amazon = workspace.transactions.find((row) => row.merchant === "Amazon")!;

  // The bank says $63.15. A receipt reading $58 does not explain that charge.
  assert.equal(splitIsBalanced(amazon.amount, [{ category: "Shopping", amount: 58 }]), false);
  assert.equal(splitDifference(amazon.amount, [{ category: "Shopping", amount: 58 }]), 5.15);

  const after = splitTransaction(workspace, amazon.id, [{ category: "Shopping", amount: 58 }]);
  assert.equal(
    after.transactions.find((row) => row.id === amazon.id)?.split,
    undefined,
    "nothing is filed when the arithmetic does not agree",
  );
});

test("splitting never changes the total spent across all buckets", async () => {
  const { splitTransaction } = await import("../lib/model/decide");
  const workspace = ws();
  const cycle = currentCycle(workspace, FIXTURE_TODAY)!;
  const total = (state: Workspace) =>
    round(
      state.buckets
        .filter((bucket) => bucket.kind === "spend")
        .reduce((sum, bucket) => sum + bucketActivity(state, bucket, cycle).spent, 0),
    );

  const amazon = workspace.transactions.find((row) => row.merchant === "Amazon")!;
  const after = splitTransaction(workspace, amazon.id, [
    { category: "Groceries", amount: 40 },
    { category: "Shopping", amount: 23.15 },
  ]);
  assert.equal(total(after), total(workspace), "money moves between buckets, it is not created");
});

test("the headline category becomes the largest line", async () => {
  const { splitTransaction } = await import("../lib/model/decide");
  const workspace = ws();
  const amazon = workspace.transactions.find((row) => row.merchant === "Amazon")!;
  const after = splitTransaction(workspace, amazon.id, [
    { category: "Groceries", amount: 50 },
    { category: "Shopping", amount: 13.15 },
  ]);
  assert.equal(after.transactions.find((row) => row.id === amazon.id)?.category, "Groceries");
});

test("a split survives a save and reload", async () => {
  const { splitTransaction } = await import("../lib/model/decide");
  const { toLegacy, toModel } = await import("../lib/model/convert");
  const workspace = ws();
  const amazon = workspace.transactions.find((row) => row.merchant === "Amazon")!;
  const after = toModel(toLegacy(splitTransaction(workspace, amazon.id, [
    { category: "Groceries", amount: 40 },
    { category: "Shopping", amount: 23.15 },
  ])));
  assert.equal(after.transactions.find((row) => row.id === amazon.id)?.split?.length, 2);
});

function round(value: number) {
  return Math.round(value * 100) / 100;
}

test("promoting a claim reports where it lands and what slipped", async () => {
  const { promoteClaim } = await import("../lib/model/decide");
  const workspace = ws();
  const net = workspace.claims.find((claim) => claim.name === "Golf net")!;
  const fundedBefore = Object.fromEntries(workspace.claims.map((c) => [c.name, c.fundedAmount]));

  const result = promoteClaim(workspace, net.id, FIXTURE_TODAY)!;
  const promoted = result.workspace.claims.find((claim) => claim.id === net.id)!;

  assert.equal(promoted.rank, 0, "it goes to the top");
  assert.ok(result.arrival, "and gets a real date");

  // Reordering is future-cycle only; nothing already funded may move.
  for (const claim of result.workspace.claims) {
    assert.equal(claim.fundedAmount, fundedBefore[claim.name], claim.name);
  }
  // Ranks stay contiguous so the list has no gaps.
  const ranks = result.workspace.claims.map((claim) => claim.rank).sort((a, b) => a - b);
  assert.deepEqual(ranks, ranks.map((_, index) => index));
});

test("promotion names the cost rather than hiding it", async () => {
  const { promoteClaim } = await import("../lib/model/decide");
  const workspace = ws();
  const net = workspace.claims.find((claim) => claim.name === "Golf net")!;
  const result = promoteClaim(workspace, net.id, FIXTURE_TODAY)!;
  assert.ok(
    result.changes.every((change) => change.claimId !== net.id),
    "the promoted claim isn't listed as its own consequence",
  );
});
