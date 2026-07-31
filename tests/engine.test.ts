import assert from "node:assert/strict";
import test from "node:test";
import {
  categoryForPlaid,
  mergePlaidFinancialData,
  suggestBudgets,
} from "../lib/financial-import";
import { createEmptyState } from "../lib/initial-state";
import {
  calculateTradeoffs,
  deterministicCategory,
  paycheckAllocation,
  splitIsValid,
  spendingByCategory,
} from "../lib/engine";

function connectedState() {
  const state = createEmptyState();
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  state.profile.nextPayday = nextWeek.toISOString().slice(0, 10);
  state.profile.minimumBuffer = 500;
  state.accounts = [
    {
      id: "checking",
      name: "Checking",
      institution: "Connected institution",
      type: "Checking",
      balance: 2_000,
      available: 2_000,
      source: "plaid",
      status: "connected",
      lastSynced: new Date().toISOString(),
    },
  ];
  state.bills = [
    {
      id: "bill",
      name: "Utility",
      amount: 100,
      dueDate: nextWeek.toISOString().slice(0, 10),
      frequency: "monthly",
      autopay: false,
      essential: true,
      accountId: "checking",
    },
  ];
  state.paycheckPlan = {
    ...state.paycheckPlan,
    expected: 1_500,
    savings: 200,
    groceries: 150,
  };
  return state;
}

test("safe-to-spend protects bills, minimum debt, savings, and buffer", () => {
  const state = connectedState();
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
  const state = connectedState();
  state.accounts.find((account) => account.type === "Checking")!.available = 50;
  assert.equal(calculateTradeoffs(state).safeToSpend, 0);
  assert.equal(calculateTradeoffs(state).risk, "High");
});

test("paycheck allocation reconciles editable allocations", () => {
  const state = connectedState();
  const result = paycheckAllocation(state);
  assert.equal(result.remaining, result.income - result.assigned);
  assert.ok(result.percentAssigned > 0);
});

test("deterministic merchant rules run before AI categorization", () => {
  assert.equal(deterministicCategory("Whole Foods Market"), "Groceries");
  assert.equal(deterministicCategory("Employer payroll"), "Paycheck");
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
  const state = connectedState();
  state.transactions = [
    {
      id: "expense",
      accountId: "checking",
      merchant: "Cafe",
      description: "Lunch",
      amount: 20,
      date: new Date().toISOString().slice(0, 10),
      category: "Dining",
      type: "expense",
    },
    {
      id: "income",
      accountId: "checking",
      merchant: "Employer",
      description: "Payroll",
      amount: 1_500,
      date: new Date().toISOString().slice(0, 10),
      category: "Paycheck",
      type: "income",
    },
  ];
  const totals = spendingByCategory(state.transactions, 30);
  assert.ok((totals.Dining ?? 0) > 0);
  assert.equal(totals.Paycheck, undefined);
});

test("Plaid categories and incremental changes become real Steward activity", () => {
  assert.equal(
    categoryForPlaid({
      transaction_id: "1",
      account_id: "a",
      name: "Market",
      amount: 40,
      date: "2026-07-30",
      personal_finance_category: {
        primary: "FOOD_AND_DRINK",
        detailed: "FOOD_AND_DRINK_GROCERIES",
      },
    }),
    "Groceries",
  );
  const state = mergePlaidFinancialData(createEmptyState(), {
    added: [
      {
        transaction_id: "1",
        account_id: "a",
        name: "Market",
        amount: 40,
        date: "2026-07-30",
        personal_finance_category: {
          primary: "FOOD_AND_DRINK",
          detailed: "FOOD_AND_DRINK_GROCERIES",
        },
      },
    ],
    modified: [],
    removed: [],
  });
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].source, "plaid");
  assert.equal(state.budgets[0].category, "Groceries");
});

test("merchant rules fill gaps and remember a user's correction", () => {
  const state = createEmptyState();
  state.transactions = [
    {
      id: "manual-cafe",
      accountId: "checking",
      merchant: "Neighborhood Cafe",
      description: "Coffee",
      amount: 5,
      date: "2026-07-20",
      category: "Hobbies",
      categorySource: "manual",
      type: "expense",
    },
  ];
  const synced = mergePlaidFinancialData(state, {
    added: [
      {
        transaction_id: "cafe-2",
        account_id: "checking",
        name: "Neighborhood Cafe",
        amount: 12,
        date: "2026-07-30",
      },
      {
        transaction_id: "grocery-1",
        account_id: "checking",
        name: "Whole Foods Market",
        amount: 30,
        date: "2026-07-30",
      },
    ],
    modified: [],
    removed: [],
  });
  assert.equal(
    synced.transactions.find((transaction) => transaction.id === "plaid-tx-cafe-2")?.category,
    "Hobbies",
  );
  assert.equal(
    synced.transactions.find((transaction) => transaction.id === "plaid-tx-cafe-2")?.categorySource,
    "learned",
  );
  assert.equal(
    synced.transactions.find((transaction) => transaction.id === "plaid-tx-grocery-1")?.category,
    "Groceries",
  );
});

test("budget suggestions protect recurring bills and keep manual budgets", () => {
  const state = createEmptyState();
  state.profile.takeHomePay = 2_000;
  state.profile.payFrequency = "Monthly";
  state.bills = [
    {
      id: "rent",
      name: "Rent",
      amount: 900,
      dueDate: "2026-08-01",
      frequency: "monthly",
      autopay: true,
      essential: true,
      accountId: "checking",
    },
  ];
  state.budgets = [
    {
      id: "manual-hobbies",
      category: "Hobbies",
      planned: 125,
      actual: 0,
      cadence: "Monthly",
      essential: false,
      source: "manual",
    },
  ];
  state.transactions = [
    {
      id: "groceries",
      accountId: "checking",
      merchant: "Market",
      description: "Groceries",
      amount: 300,
      date: "2026-07-30",
      category: "Groceries",
      type: "expense",
    },
  ];
  const budgets = suggestBudgets(state, state.transactions, state.bills, new Date("2026-07-31T12:00:00"));
  assert.equal(budgets.find((budget) => budget.category === "Hobbies")?.planned, 125);
  assert.equal(budgets.find((budget) => budget.category === "Groceries")?.source, "suggested");
});
