/**
 * GOLDEN FIXTURE — the canonical Steward test user.
 *
 * This workspace is the reference case for every phase of the redesign. It is
 * deterministic: all dates are absolute and anchored to FIXTURE_TODAY so the
 * same inputs always produce the same engine output and the same screenshots.
 *
 * Never make these values relative to `new Date()`. Never randomise them.
 *
 * The expected engine results for this fixture are recorded in
 * `fixtures/golden-expectations.ts`. If a change to the engine moves any of
 * those numbers, that is a deliberate decision that must be reviewed — not a
 * test to be updated silently.
 *
 * Profile: biweekly $2,150 take-home, $1,600/mo rent, a 23.99% card, a 6.4%
 * auto loan, four everyday spending categories, two projects, three wants.
 */

import type { StewardState, Transaction } from "../lib/steward-types";

/** The simulated "now" for all fixture-based calculations. */
export const FIXTURE_TODAY = "2026-08-01";

/** Cycle boundaries implied by the fixture: paid 07-27, next paycheck 08-10. */
export const FIXTURE_CYCLE = { start: "2026-07-27", end: "2026-08-10" };

const CHECKING = "fixture-checking";
const SAVINGS = "fixture-savings";
const CARD = "fixture-card";
const LOAN = "fixture-loan";

function expense(
  id: string,
  merchant: string,
  amount: number,
  date: string,
  category: string,
  accountId = CHECKING,
): Transaction {
  return {
    id,
    accountId,
    merchant,
    description: merchant,
    amount,
    date,
    category,
    type: "expense",
    source: "plaid",
    categorySource: "plaid",
    confidence: 0.95,
  };
}

function income(id: string, amount: number, date: string): Transaction {
  return {
    id,
    accountId: CHECKING,
    merchant: "Employer Payroll",
    description: "DIRECT DEP PAYROLL",
    amount,
    date,
    category: "Paycheck",
    type: "income",
    source: "plaid",
    categorySource: "plaid",
    confidence: 0.99,
  };
}

/**
 * Three months of recurring history so budget suggestion and pattern detection
 * have something real to work with. Fixed amounts, no randomness.
 */
function priorCycles(): Transaction[] {
  const paydays = ["2026-05-18", "2026-06-01", "2026-06-15", "2026-06-29", "2026-07-13"];
  const rentDays = ["2026-05-28", "2026-06-28", "2026-07-28"];
  const utilityDays = ["2026-05-05", "2026-06-05", "2026-07-05"];
  const rows: Transaction[] = [];

  paydays.forEach((date, index) => rows.push(income(`fx-pay-${index}`, 2150, date)));
  rentDays.forEach((date, index) =>
    rows.push(expense(`fx-rent-${index}`, "Riverside Apartments", 1600, date, "Housing")),
  );
  utilityDays.forEach((date, index) => {
    rows.push(expense(`fx-elec-${index}`, "City Electric", 96, date, "Utilities"));
    rows.push(expense(`fx-net-${index}`, "Beam Internet", 70, date, "Utilities"));
    rows.push(expense(`fx-phone-${index}`, "Cell Provider", 55, date, "Utilities"));
  });

  // Everyday spending, steady across the three months.
  const groceryDays = ["2026-05-09", "2026-05-23", "2026-06-06", "2026-06-20", "2026-07-04", "2026-07-18"];
  groceryDays.forEach((date, index) =>
    rows.push(expense(`fx-groc-${index}`, "Whole Foods", 148, date, "Groceries")),
  );
  const gasDays = ["2026-05-12", "2026-06-02", "2026-06-24", "2026-07-09"];
  gasDays.forEach((date, index) =>
    rows.push(expense(`fx-gas-${index}`, "Shell", 58, date, "Transportation")),
  );
  const diningDays = ["2026-05-16", "2026-06-11", "2026-07-02", "2026-07-21"];
  diningDays.forEach((date, index) =>
    rows.push(expense(`fx-dine-${index}`, "Sunrise Diner", 72, date, "Dining")),
  );

  // Minimum payments actually being made.
  ["2026-05-13", "2026-06-13", "2026-07-13"].forEach((date, index) =>
    rows.push(expense(`fx-card-${index}`, "Card Payment", 78, date, "Debt payments")),
  );
  ["2026-05-16", "2026-06-16", "2026-07-16"].forEach((date, index) =>
    rows.push(expense(`fx-loan-${index}`, "Ally Auto", 289, date, "Debt payments")),
  );

  return rows;
}

/** The current cycle: 2026-07-27 through 2026-08-10. */
function currentCycle(): Transaction[] {
  return [
    income("fx-cur-pay", 2150, "2026-07-27"),
    expense("fx-cur-rent", "Riverside Apartments", 1600, "2026-07-27", "Housing"),
    expense("fx-cur-amazon", "Amazon", 63.15, "2026-07-27", "Shopping"),
    expense("fx-cur-gas", "Shell", 29.1, "2026-07-28", "Transportation"),
    expense("fx-cur-groc", "Whole Foods", 82.4, "2026-07-29", "Groceries"),
    expense("fx-cur-hardware", "Ace Hardware", 74.9, "2026-07-29", "Projects"),
    expense("fx-cur-diner", "Sunrise Diner", 41.2, "2026-07-30", "Dining"),
    expense("fx-cur-netflix", "Netflix", 15.49, "2026-07-30", "Entertainment"),
    expense("fx-cur-ck1", "Circle K", 12.4, "2026-07-31", "Dining"),
    expense("fx-cur-ck2", "Circle K", 9.8, "2026-07-29", "Dining"),
    {
      ...expense("fx-cur-unknown", "Unknown POS 4471", 38, "2026-07-31", "Uncategorized"),
      categorySource: "rule",
      confidence: 0.4,
      needsReview: true,
    },
  ];
}

export function goldenWorkspace(
  name = "Jordan Rivera",
  email = "golden@steward.app",
): StewardState {
  return {
    version: 2,
    profile: {
      name,
      email,
      currency: "USD",
      nextPayday: FIXTURE_CYCLE.end,
      payFrequency: "Biweekly",
      takeHomePay: 2150,
      minimumBuffer: 400,
      riskTolerance: "Balanced",
      budgetingStyle: "Paycheck plan",
      theme: "light",
      onboardingComplete: true,
    },

    accounts: [
      {
        id: CHECKING,
        name: "Everyday Checking",
        institution: "First National",
        type: "Checking",
        balance: 1840,
        available: 1840,
        source: "plaid",
        status: "connected",
        lastSynced: "2026-08-01T14:00:00.000Z",
      },
      {
        id: SAVINGS,
        name: "Savings",
        institution: "First National",
        type: "Savings",
        balance: 310,
        available: 310,
        source: "plaid",
        status: "connected",
        lastSynced: "2026-08-01T14:00:00.000Z",
      },
      {
        id: CARD,
        name: "Travel Rewards Card",
        institution: "Chase",
        type: "Credit card",
        balance: 2679,
        available: 2321,
        creditLimit: 5000,
        interestRate: 23.99,
        minimumPayment: 78,
        dueDate: "2026-08-13",
        source: "plaid",
        status: "connected",
        lastSynced: "2026-08-01T14:00:00.000Z",
      },
      {
        id: LOAN,
        name: "Auto Loan",
        institution: "Ally",
        type: "Loan",
        balance: 8420,
        available: 0,
        interestRate: 6.4,
        minimumPayment: 289,
        dueDate: "2026-08-16",
        source: "plaid",
        status: "connected",
        lastSynced: "2026-08-01T14:00:00.000Z",
      },
    ],

    transactions: [...currentCycle(), ...priorCycles()].sort((a, b) =>
      b.date.localeCompare(a.date),
    ),

    // Obligations. In the new model these become `reserve` buckets; rent is the
    // case that proves pro-rating (due 08-28, two paychecks away).
    bills: [
      { id: "fx-bill-rent", name: "Rent", amount: 1600, dueDate: "2026-08-28", frequency: "monthly", autopay: false, essential: true, accountId: CHECKING },
      { id: "fx-bill-elec", name: "Electric", amount: 96, dueDate: "2026-08-05", frequency: "monthly", autopay: true, essential: true, accountId: CHECKING },
      { id: "fx-bill-net", name: "Internet", amount: 70, dueDate: "2026-08-07", frequency: "monthly", autopay: true, essential: true, accountId: CHECKING },
      { id: "fx-bill-phone", name: "Phone", amount: 55, dueDate: "2026-08-09", frequency: "monthly", autopay: true, essential: false, accountId: CHECKING },
    ],

    // Everyday spending buckets.
    budgets: [
      { id: "fx-bud-groceries", category: "Groceries", planned: 300, actual: 82.4, cadence: "Monthly", essential: true, source: "suggested", paycheckAmount: 150 },
      { id: "fx-bud-dining", category: "Dining", planned: 150, actual: 63.4, cadence: "Monthly", essential: false, source: "suggested", paycheckAmount: 75 },
      { id: "fx-bud-transport", category: "Transportation", planned: 120, actual: 29.1, cadence: "Monthly", essential: true, source: "suggested", paycheckAmount: 60 },
      { id: "fx-bud-household", category: "Shopping", planned: 74, actual: 63.15, cadence: "Monthly", essential: false, source: "suggested", paycheckAmount: 37 },
    ],

    // Becomes a `fund` Claim.
    goals: [
      { id: "fx-goal-cushion", name: "Cushion", type: "Emergency fund", target: 2000, current: 310, targetDate: "2027-04-01", priority: "High", status: "Active", recommendedContribution: 100, paycheckContribution: 100 },
    ],

    // Becomes Projects containing purchase Claims.
    projects: [
      { id: "fx-proj-apartment", name: "Apartment", description: "Finish furnishing the place.", category: "Home", priority: "Medium", status: "Active", targetDate: "2026-12-01", estimatedCost: 900, actualCost: 275, paycheckContribution: 0, progress: 31, nextAction: "Order window film", tasks: [
        { id: "fx-task-film", title: "Window film", complete: true },
        { id: "fx-task-counter", title: "Kitchen counter", complete: false },
        { id: "fx-task-shelf", title: "Bookshelf", complete: false },
      ] },
      { id: "fx-proj-golf", name: "Golf", description: "Home practice setup.", category: "Hobby", priority: "Low", status: "Planned", targetDate: "2027-03-01", estimatedCost: 600, actualCost: 0, paycheckContribution: 0, progress: 0, nextAction: "Compare hitting nets", tasks: [] },
    ],

    // Becomes purchase Claims.
    wishlist: [
      { id: "fx-wish-keyboard", name: "Logitech keyboard", category: "Shopping", priority: "High", price: 90, desiredDate: "2026-08-08", safeDate: "2026-08-01", status: "Recommended now", reason: "Fits this cycle without touching bills or the buffer." },
      { id: "fx-wish-net", name: "Golf net", projectId: "fx-proj-golf", category: "Hobbies", priority: "Medium", price: 130, desiredDate: "2026-08-20", safeDate: "2026-09-07", status: "Wait", reason: "Waiting keeps the card payoff on schedule." },
      { id: "fx-wish-shelf", name: "Bookshelf", projectId: "fx-proj-apartment", category: "Home", priority: "Low", price: 450, desiredDate: "2026-11-01", safeDate: "2026-10-15", status: "Considering", reason: "Large relative to a single cycle." },
    ],

    paycheckPlan: { date: FIXTURE_CYCLE.end, expected: 2150, actual: 0, savings: 100, debt: 250, groceries: 150, transportation: 60, dining: 75, buffer: 0, projects: 0 },

    recommendations: [],
    memories: [],
    reviews: [],
    notifications: [],
    notificationPreferences: { bills: true, sync: true, recommendations: true, weeklyReview: true },
  };
}

/**
 * The public demo starts immediately after a bank connection, not after setup.
 * Accounts, statements, detected bills, and suggested spending buckets are
 * present because those are outputs of the import. Personal goals are empty so
 * the visitor supplies them during the conversation and watches Steward build
 * the final plan from their answers.
 */
export function demoWorkspace(
  name = "Jordan Rivera",
  email = "demo@steward.app",
): StewardState {
  const state = goldenWorkspace(name, email);
  return {
    ...state,
    profile: { ...state.profile, onboardingComplete: false },
    // The canonical dashboard fixture intentionally has two near-identical
    // July rent rows for cycle-edge tests. A bank demo should not present that
    // artificial test seam as real spending.
    transactions: state.transactions.filter((entry) => entry.id !== "fx-rent-2"),
    goals: [],
    projects: [],
    wishlist: [],
    reviews: [],
    recommendations: [],
  };
}
