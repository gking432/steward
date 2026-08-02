import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_TODAY, goldenWorkspace } from "../fixtures/golden-workspace";
import { toModel } from "../lib/model/convert";
import {
  annualCost,
  detectStreams,
  incomeObservations,
  spendingByCategory,
  subscriptions,
} from "../lib/model/observations";
import type { Transaction, Workspace } from "../lib/model/types";

/**
 * The onboarding conversation opens its factual phases with "here's what I
 * noticed". These test that Steward only claims to have noticed things that are
 * actually true, and stays quiet otherwise — a wrong observation is worse than
 * none, because it tells the user Steward is guessing about their money.
 */

const base = () => toModel(goldenWorkspace());

const tx = (over: Partial<Transaction> & Pick<Transaction, "id" | "merchant" | "amount" | "date">): Transaction => ({
  accountId: "checking-1",
  description: over.merchant,
  category: "Uncategorized",
  type: "expense",
  ...over,
});

/** Add rows to the golden workspace without disturbing anything it already asserts. */
function withRows(rows: Transaction[]): Workspace {
  const workspace = base();
  return { ...workspace, transactions: [...workspace.transactions, ...rows] };
}

/* ------------------------------------------------------------- cadence -- */

test("a biweekly paycheck is recognized as the primary income", () => {
  const { primary } = incomeObservations(base(), FIXTURE_TODAY);
  assert.equal(primary?.merchant, "Employer Payroll");
  assert.equal(primary?.cadence, "biweekly");
  assert.equal(primary?.typicalAmount, 2150);
});

test("a clean single income stream leaves nothing to ask about", () => {
  // The "don't ask" branch. When there is one obvious paycheck and nothing
  // else, Steward states it and moves on rather than manufacturing a question.
  const { others } = incomeObservations(base(), FIXTURE_TODAY);
  assert.deepEqual(others, []);
});

test("a second, irregular deposit is surfaced for a question", () => {
  const workspace = withRows([
    tx({ id: "o1", merchant: "Zelle From Mom", amount: 300, date: "2026-06-04", type: "income", category: "Other income" }),
    tx({ id: "o2", merchant: "Zelle From Mom", amount: 250, date: "2026-07-02", type: "income", category: "Other income" }),
  ]);
  const { primary, others } = incomeObservations(workspace, FIXTURE_TODAY);
  assert.equal(primary?.merchant, "Employer Payroll", "payroll is still primary");
  assert.equal(others.length, 1);
  assert.equal(others[0].merchant, "Zelle From Mom");
  assert.equal(others[0].cadence, "irregular", "two deposits is not a schedule");
});

test("roughly-every-three-weeks stays irregular rather than being rounded to a cadence", () => {
  // Steward plans around cadences. Rounding 21 days to "biweekly" would build a
  // plan on income that isn't arriving when the plan says it does.
  const workspace = withRows([
    tx({ id: "g1", merchant: "Side Gig", amount: 400, date: "2026-05-20", type: "income", category: "Other income" }),
    tx({ id: "g2", merchant: "Side Gig", amount: 400, date: "2026-06-10", type: "income", category: "Other income" }),
    tx({ id: "g3", merchant: "Side Gig", amount: 400, date: "2026-07-01", type: "income", category: "Other income" }),
  ]);
  const gig = detectStreams(workspace, FIXTURE_TODAY).find((s) => s.merchant === "Side Gig")!;
  assert.equal(gig.medianGapDays, 21);
  assert.equal(gig.cadence, "irregular");
});

test("transfers between the user's own accounts never become income", () => {
  const workspace = withRows([
    tx({ id: "t1", merchant: "Savings Transfer", amount: 500, date: "2026-06-01", type: "transfer" }),
    tx({ id: "t2", merchant: "Savings Transfer", amount: 500, date: "2026-06-15", type: "transfer" }),
    tx({ id: "t3", merchant: "Savings Transfer", amount: 500, date: "2026-06-29", type: "transfer" }),
  ]);
  const { primary, others } = incomeObservations(workspace, FIXTURE_TODAY);
  assert.equal(primary?.merchant, "Employer Payroll");
  assert.equal(others.some((s) => s.merchant === "Savings Transfer"), false);
});

/* ------------------------------------------------------- subscriptions -- */

test("a fixed monthly charge is a subscription, and its annual cost is real", () => {
  const workspace = withRows([
    tx({ id: "n1", merchant: "Netflix", amount: 15.49, date: "2026-05-30", category: "Entertainment" }),
    tx({ id: "n2", merchant: "Netflix", amount: 15.49, date: "2026-06-30", category: "Entertainment" }),
  ]);
  const found = subscriptions(workspace, FIXTURE_TODAY).find((s) => s.merchant === "Netflix")!;
  assert.equal(found.cadence, "monthly");
  assert.equal(found.typicalAmount, 15.49);
  assert.equal(annualCost(found), 185.88);
});

test("groceries recur but are not a subscription — the amount moves", () => {
  // The distinction the whole feature rests on: cadence alone would file a
  // weekly grocery run as a subscription to cancel.
  const names = subscriptions(base(), FIXTURE_TODAY).map((s) => s.merchant);
  assert.equal(names.includes("Whole Foods"), false);
});

test("a bill that already has a reserve bucket is not offered as a subscription", () => {
  const names = subscriptions(base(), FIXTURE_TODAY).map((s) => s.merchant);
  assert.equal(names.includes("Riverside Apartments"), false, "rent is not a subscription");
});

/* ------------------------------------------------------------ spending -- */

test("categories are ranked by spend and name their own merchants", () => {
  const totals = spendingByCategory(base(), FIXTURE_TODAY);
  assert.ok(totals.length > 0);
  const housing = totals.find((entry) => entry.category === "Housing")!;
  assert.ok(housing.merchants.includes("Riverside Apartments"));
  for (let i = 1; i < totals.length; i += 1) {
    assert.ok(totals[i - 1].total >= totals[i].total, "sorted by total, descending");
  }
});

test("shares sum to one, so the bucket count comes from real proportions", () => {
  const totals = spendingByCategory(base(), FIXTURE_TODAY);
  const sum = totals.reduce((acc, entry) => acc + entry.share, 0);
  assert.ok(Math.abs(sum - 1) < 0.02, `shares summed to ${sum}`);
});

test("a split transaction lands in every category it was split into", () => {
  const workspace = withRows([
    tx({
      id: "s1",
      merchant: "Target",
      amount: 100,
      date: "2026-07-20",
      category: "Shopping",
      split: [
        { category: "Groceries", amount: 60 },
        { category: "Household", amount: 40 },
      ],
    }),
  ]);
  const totals = spendingByCategory(workspace, FIXTURE_TODAY);
  const groceries = totals.find((e) => e.category === "Groceries")!.total;
  const household = totals.find((e) => e.category === "Household")!.total;
  const baseline = spendingByCategory(base(), FIXTURE_TODAY);
  const groceriesBefore = baseline.find((e) => e.category === "Groceries")!.total;
  const householdBefore = baseline.find((e) => e.category === "Household")?.total ?? 0;

  // Compared with a tolerance: these are differences of rounded sums, so exact
  // equality trips on binary float representation rather than on any real error.
  assert.ok(Math.abs(groceries - groceriesBefore - 60) < 0.01);
  assert.ok(Math.abs(household - householdBefore - 40) < 0.01);
  assert.equal(
    totals.find((e) => e.category === "Shopping")!.total,
    baseline.find((e) => e.category === "Shopping")!.total,
    "the receipt's own category gains nothing — it was split away",
  );
});

test("excluded and pending rows are left out of every observation", () => {
  const workspace = withRows([
    tx({ id: "x1", merchant: "Ghost Charge", amount: 900, date: "2026-07-20", category: "Shopping", excluded: true }),
    tx({ id: "x2", merchant: "Pending Charge", amount: 800, date: "2026-07-21", category: "Shopping", pending: true }),
  ]);
  const categories = spendingByCategory(workspace, FIXTURE_TODAY);
  const shopping = categories.find((e) => e.category === "Shopping")!;
  assert.equal(shopping.merchants.includes("Ghost Charge"), false);
  assert.equal(shopping.merchants.includes("Pending Charge"), false);
});

test("observations are bounded by the window rather than the whole ledger", () => {
  const workspace = withRows([
    tx({ id: "old", merchant: "Cancelled Gym", amount: 40, date: "2026-01-05", category: "Health" }),
    tx({ id: "old2", merchant: "Cancelled Gym", amount: 40, date: "2026-02-05", category: "Health" }),
    tx({ id: "old3", merchant: "Cancelled Gym", amount: 40, date: "2026-03-05", category: "Health" }),
  ]);
  const names = subscriptions(workspace, FIXTURE_TODAY).map((s) => s.merchant);
  assert.equal(names.includes("Cancelled Gym"), false, "stopped in March, not offered in August");
});
