import assert from "node:assert/strict";
import test from "node:test";
import { goldenWorkspace } from "../fixtures/golden-workspace";
import { createEmptyState } from "../lib/initial-state";
import { derivedOnly, storedOnly, toLegacy, toModel } from "../lib/model/convert";
import type { StewardState } from "../lib/steward-types";

/**
 * PHASE 1 GATE.
 *
 * The converter must be lossless in both directions. Until that holds, the new
 * engine cannot be built as a read-time adapter and the redesign stops being
 * reversible.
 */

function roundTrip(state: StewardState) {
  return toLegacy(toModel(state));
}

test("round-trips the golden fixture exactly", () => {
  const state = goldenWorkspace();
  assert.deepEqual(roundTrip(state), state);
});

test("round-trips an empty first-run workspace exactly", () => {
  const state = createEmptyState();
  assert.deepEqual(roundTrip(state), state);
});

test("round-trip is stable when applied repeatedly", () => {
  const state = goldenWorkspace();
  assert.deepEqual(roundTrip(roundTrip(roundTrip(state))), state);
});

test("preserves collection order, including collapsed collections", () => {
  const state = goldenWorkspace();
  const result = roundTrip(state);
  assert.deepEqual(result.bills.map((b) => b.id), state.bills.map((b) => b.id));
  assert.deepEqual(result.budgets.map((b) => b.id), state.budgets.map((b) => b.id));
  // goals and wishlist both become claims; order must survive the collapse.
  assert.deepEqual(result.goals.map((g) => g.id), state.goals.map((g) => g.id));
  assert.deepEqual(result.wishlist.map((w) => w.id), state.wishlist.map((w) => w.id));
  assert.deepEqual(result.projects.map((p) => p.id), state.projects.map((p) => p.id));
});

test("bills become reserve buckets and budgets become spend buckets", () => {
  const model = toModel(goldenWorkspace());
  const stored = storedOnly(model.buckets);
  const reserves = stored.filter((bucket) => bucket.kind === "reserve");
  const spend = stored.filter((bucket) => bucket.kind === "spend");

  assert.equal(reserves.length, 4);
  assert.equal(spend.length, 4);

  const rent = reserves.find((bucket) => bucket.name === "Rent");
  assert.ok(rent);
  assert.equal(rent.amountDue, 1600);
  assert.equal(rent.dueDate, "2026-08-28");
  // Pro-rating is the Phase 2 engine's job; the converter only carries facts.
  assert.equal(rent.reserved, 0);
});

test("debt minimums become obligations, payoff becomes a ranked claim", () => {
  const model = toModel(goldenWorkspace());

  const minimums = derivedOnly(model.buckets);
  assert.equal(minimums.length, 2, "card and loan minimums");
  assert.deepEqual(
    minimums.map((bucket) => bucket.amountDue).sort((a, b) => (a ?? 0) - (b ?? 0)),
    [78, 289],
  );
  assert.ok(
    minimums.every((bucket) => bucket.kind === "reserve" && bucket.essential),
    "minimums are non-negotiable obligations, never ranked",
  );

  const payoffs = derivedOnly(model.claims);
  assert.equal(payoffs.length, 2);
  // Highest APR first.
  assert.equal(payoffs[0].name, "Travel Rewards Card");
  assert.deepEqual(payoffs[0].delayCost, { type: "interest", apr: 23.99 });
  assert.equal(payoffs[1].name, "Auto Loan");
  assert.deepEqual(payoffs[1].delayCost, { type: "interest", apr: 6.4 });
});

test("derived objects never leak back into stored state", () => {
  const state = goldenWorkspace();
  const model = toModel(state);
  assert.ok(derivedOnly(model.buckets).length > 0);
  assert.ok(derivedOnly(model.claims).length > 0);
  assert.ok(derivedOnly(model.cycles).length > 0);

  const result = toLegacy(model);
  // The two debt minimums must not have become bills.
  assert.equal(result.bills.length, state.bills.length);
  // The two payoff claims must not have become goals or wishlist items.
  assert.equal(result.goals.length, state.goals.length);
  assert.equal(result.wishlist.length, state.wishlist.length);
});

test("purchases are indivisible and funds are divisible", () => {
  const model = toModel(goldenWorkspace());
  const keyboard = model.claims.find((claim) => claim.name === "Logitech keyboard");
  const cushion = model.claims.find((claim) => claim.name === "Cushion");
  assert.equal(keyboard?.kind, "purchase");
  assert.equal(keyboard?.divisible, false, "half a keyboard is nothing");
  assert.equal(cushion?.kind, "fund");
  assert.equal(cushion?.divisible, true);
});

test("wantBy is carried as an input and no arrival date is invented", () => {
  const model = toModel(goldenWorkspace());
  const net = model.claims.find((claim) => claim.name === "Golf net");
  assert.equal(net?.wantBy, "2026-08-20", "the user's desired date is an input");
  assert.ok(
    !Object.prototype.hasOwnProperty.call(net ?? {}, "arrivalDate"),
    "the converter must never author an arrival date",
  );
});

test("claims carry funded amounts that ranking cannot disturb", () => {
  const state = goldenWorkspace();
  const model = toModel(state);
  const cushion = model.claims.find((claim) => claim.name === "Cushion");
  assert.equal(cushion?.fundedAmount, 310);

  // Reranking is a future-cycle concern; it must never touch funded money.
  const reranked = {
    ...model,
    claims: model.claims.map((claim) => ({ ...claim, rank: 99 - claim.rank })),
  };
  assert.equal(
    reranked.claims.find((claim) => claim.name === "Cushion")?.fundedAmount,
    310,
  );
});

test("rules are recovered from confirmed manual categorisations", () => {
  const state = goldenWorkspace();
  state.transactions = [
    { ...state.transactions[0], id: "m1", merchant: "Circle K", category: "Groceries", categorySource: "manual", date: "2026-07-31" },
    { ...state.transactions[0], id: "m2", merchant: "Circle K", category: "Dining", categorySource: "manual", date: "2026-07-01" },
  ];
  const rules = toModel(state).rules;
  assert.equal(rules.length, 1);
  // The most recent correction wins.
  assert.equal(rules[0].category, "Groceries");
});

test("a workspace with no payday derives no cycle rather than guessing one", () => {
  const state = createEmptyState();
  assert.equal(toModel(state).cycles.length, 0);
});

test("legacy fields with no model home survive untouched", () => {
  const state = goldenWorkspace();
  state.memories = [{ id: "m", label: "Rule", value: "Never below $400.", category: "Rule" }];
  state.notifications = [{ id: "n", title: "T", body: "B", time: "2h", read: false, type: "bill" }];
  state.recommendations = [{ id: "r", title: "T", description: "D", type: "protect", priority: "now", impact: 1, confidence: 1, reason: "R", action: "A", status: "active" }];
  assert.deepEqual(roundTrip(state), state);
});
