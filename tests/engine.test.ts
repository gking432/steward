import assert from "node:assert/strict";
import test from "node:test";
import { createDemoState } from "../lib/demo-data";
import {
  calculateTradeoffs,
  deterministicCategory,
  paycheckAllocation,
  splitIsValid,
  spendingByCategory,
} from "../lib/engine";

test("safe-to-spend protects bills, minimum debt, savings, and buffer", () => {
  const state = createDemoState();
  const result = calculateTradeoffs(state);
  assert.ok(result.safeToSpend >= 0);
  assert.equal(
    result.safeToSpend,
    Math.max(
      0,
      result.liquidCash -
        result.billsBeforePayday -
        result.requiredDebt -
        result.savingsCommitment -
        state.profile.minimumBuffer,
    ),
  );
  assert.ok(result.expectedBalance >= state.profile.minimumBuffer);
});

test("safe-to-spend never becomes negative", () => {
  const state = createDemoState();
  state.accounts.find((account) => account.type === "Checking")!.available = 50;
  assert.equal(calculateTradeoffs(state).safeToSpend, 0);
  assert.equal(calculateTradeoffs(state).risk, "High");
});

test("paycheck allocation reconciles editable allocations", () => {
  const state = createDemoState();
  const result = paycheckAllocation(state);
  assert.equal(result.remaining, result.income - result.assigned);
  assert.ok(result.percentAssigned > 0);
});

test("deterministic merchant rules run before AI categorization", () => {
  assert.equal(deterministicCategory("Whole Foods Market"), "Groceries");
  assert.equal(deterministicCategory("Northwind Payroll"), "Paycheck");
  assert.equal(deterministicCategory("Unknown Merchant"), "Uncategorized");
});

test("transaction splits require exact reconciliation", () => {
  assert.equal(
    splitIsValid(100, [
      { amount: 40 },
      { amount: 60 },
    ]),
    true,
  );
  assert.equal(
    splitIsValid(100, [
      { amount: 40 },
      { amount: 59 },
    ]),
    false,
  );
});

test("spending aggregation excludes income and excluded activity", () => {
  const state = createDemoState();
  const totals = spendingByCategory(state.transactions, 30);
  assert.ok((totals.Dining ?? 0) > 0);
  assert.equal(totals.Paycheck, undefined);
});
