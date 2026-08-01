import type {
  Bill,
  PaycheckBucket,
  StewardState,
  TradeoffResult,
  Transaction,
} from "./steward-types";

export const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

export function daysUntil(date: string, from = new Date()) {
  const target = new Date(`${date}T12:00:00`);
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  return Math.ceil((target.getTime() - start.getTime()) / 86_400_000);
}

export function isDueBefore(
  bill: Bill,
  payday: string,
  from = new Date(),
) {
  const due = new Date(`${bill.dueDate}T12:00:00`).getTime();
  const pay = new Date(`${payday}T12:00:00`).getTime();
  return !bill.paid && due >= from.setHours(0, 0, 0, 0) && due <= pay;
}

export function calculateTradeoffs(state: StewardState): TradeoffResult {
  const liquidCash = state.accounts
    .filter((account) => ["Checking", "Cash"].includes(account.type))
    .reduce((sum, account) => sum + Math.max(0, account.available), 0);
  const billsBeforePayday = state.bills
    .filter((bill) => isDueBefore(bill, state.profile.nextPayday))
    .reduce((sum, bill) => sum + bill.amount, 0);
  const requiredDebt = state.accounts
    .filter((account) => account.type === "Credit card")
    .reduce((sum, account) => sum + (account.minimumPayment ?? 0), 0);
  const savingsCommitment = state.paycheckPlan.savings;
  const safeToSpend = Math.max(
    0,
    liquidCash -
      billsBeforePayday -
      requiredDebt -
      savingsCommitment -
      state.profile.minimumBuffer,
  );
  const expectedBalance =
    liquidCash - billsBeforePayday - requiredDebt - savingsCommitment;
  const bufferRatio =
    state.profile.minimumBuffer === 0
      ? 1
      : expectedBalance / state.profile.minimumBuffer;
  const risk: TradeoffResult["risk"] =
    safeToSpend <= 0 ? "High" : bufferRatio < 1.3 ? "Moderate" : "Low";

  return {
    liquidCash,
    billsBeforePayday,
    requiredDebt,
    savingsCommitment,
    safeToSpend,
    risk,
    expectedBalance,
    reasons: [
      `${money(billsBeforePayday)} is reserved for bills due before payday.`,
      `${money(requiredDebt)} covers required card payments.`,
      `${money(state.profile.minimumBuffer)} remains protected as your checking buffer.`,
    ],
    assumptions: [
      `Next paycheck arrives ${state.profile.nextPayday}.`,
      "Pending transactions are included in account available balances.",
      "No untracked cash obligations are assumed.",
    ],
  };
}

export function spendingByCategory(transactions: Transaction[], days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return transactions
    .filter(
      (transaction) =>
        transaction.type === "expense" &&
        !transaction.excluded &&
        new Date(transaction.date) >= cutoff,
    )
    .reduce<Record<string, number>>((result, transaction) => {
      result[transaction.category] =
        (result[transaction.category] ?? 0) + transaction.amount;
      return result;
    }, {});
}

function shiftPayday(date: Date, frequency: StewardState["profile"]["payFrequency"], direction: 1 | -1) {
  const shifted = new Date(date);
  if (frequency === "Weekly") shifted.setDate(shifted.getDate() + 7 * direction);
  else if (frequency === "Biweekly") shifted.setDate(shifted.getDate() + 14 * direction);
  else shifted.setMonth(shifted.getMonth() + direction);
  return shifted;
}

export function currentPayPeriod(state: StewardState, today = new Date()) {
  const parsed = new Date(`${state.profile.nextPayday}T12:00:00`);
  let next = Number.isNaN(parsed.getTime()) ? new Date(today) : parsed;
  next.setHours(12, 0, 0, 0);
  const now = new Date(today);
  now.setHours(12, 0, 0, 0);
  while (next <= now) next = shiftPayday(next, state.profile.payFrequency, 1);
  const start = shiftPayday(next, state.profile.payFrequency, -1);
  return {
    start: start.toISOString().slice(0, 10),
    end: next.toISOString().slice(0, 10),
  };
}

function paychecksPerMonth(state: StewardState) {
  if (state.profile.payFrequency === "Weekly") return 52 / 12;
  if (state.profile.payFrequency === "Biweekly") return 26 / 12;
  return 1;
}

function bucketPercent(current: number, target: number) {
  return target > 0 ? (current / target) * 100 : 0;
}

export function paycheckBuckets(state: StewardState, today = new Date()): PaycheckBucket[] {
  const period = currentPayPeriod(state, today);
  const cycleTransactions = state.transactions.filter(
    (transaction) =>
      transaction.date >= period.start &&
      transaction.date < period.end &&
      !transaction.excluded &&
      !transaction.pending,
  );
  const spending = cycleTransactions
    .filter((transaction) => transaction.type === "expense")
    .reduce<Record<string, number>>((totals, transaction) => {
      totals[transaction.category] = (totals[transaction.category] ?? 0) + transaction.amount;
      return totals;
    }, {});
  const perMonth = paychecksPerMonth(state);
  const buckets: PaycheckBucket[] = [];
  const hasDebt = state.accounts.some((account) => ["Credit card", "Loan"].includes(account.type) && account.balance > 0);
  const hasBills = state.bills.length > 0;

  for (const bill of state.bills.filter((item) => item.dueDate >= period.start && item.dueDate <= period.end)) {
    const paid = bill.paid ? bill.amount : 0;
    buckets.push({
      id: `bill-${bill.id}`,
      sourceId: bill.id,
      kind: "bill",
      group: "Must cover",
      name: bill.name,
      assigned: bill.amount,
      progressCurrent: paid,
      progressTarget: bill.amount,
      percent: bucketPercent(paid, bill.amount),
      progressLabel: bill.paid ? "paid" : `due ${bill.dueDate}`,
      editable: true,
    });
  }

  for (const budget of state.budgets) {
    if (budget.category === "Debt payments" && hasDebt) continue;
    if (hasBills && ["Housing", "Utilities", "Insurance"].includes(budget.category)) continue;
    const assigned = budget.paycheckAmount ?? budget.planned / perMonth;
    const actual = spending[budget.category] ?? 0;
    buckets.push({
      id: `spending-${budget.id}`,
      sourceId: budget.id,
      kind: "spending",
      group: budget.essential ? "Must cover" : "Everyday",
      name: budget.category,
      assigned,
      progressCurrent: actual,
      progressTarget: assigned,
      percent: bucketPercent(actual, assigned),
      progressLabel: "spent this paycheck",
      editable: true,
    });
  }

  const debts = state.accounts.filter((account) => ["Credit card", "Loan"].includes(account.type) && account.balance > 0);
  const debtMinimums = debts.reduce((sum, debt) => sum + (debt.minimumPayment ?? 0), 0);
  if (debts.length) {
    const assigned = debtMinimums + state.paycheckPlan.debt;
    const actual = spending["Debt payments"] ?? 0;
    buckets.push({
      id: "debt-payoff",
      sourceId: "debt-payoff",
      kind: "debt",
      group: "Must cover",
      name: debts.length === 1 ? debts[0].name : "Debt payments",
      assigned,
      progressCurrent: actual,
      progressTarget: assigned,
      percent: bucketPercent(actual, assigned),
      progressLabel: "paid this paycheck",
      editable: true,
    });
  }

  for (const goal of state.goals.filter((item) => item.status === "Active")) {
    const assigned = goal.paycheckContribution ?? goal.recommendedContribution;
    buckets.push({
      id: `goal-${goal.id}`,
      sourceId: goal.id,
      kind: "goal",
      group: "Future",
      name: goal.name,
      assigned,
      progressCurrent: goal.current,
      progressTarget: goal.target,
      percent: bucketPercent(goal.current, goal.target),
      progressLabel: "funded overall",
      editable: true,
    });
  }

  const activeProjects = state.projects.filter((item) => ["Active", "Planned"].includes(item.status));
  for (const project of activeProjects) {
    const fallback = activeProjects.length ? state.paycheckPlan.projects / activeProjects.length : 0;
    const assigned = project.paycheckContribution ?? fallback;
    buckets.push({
      id: `project-${project.id}`,
      sourceId: project.id,
      kind: "project",
      group: "Future",
      name: project.name,
      assigned,
      progressCurrent: project.actualCost,
      progressTarget: project.estimatedCost,
      percent: project.progress || bucketPercent(project.actualCost, project.estimatedCost),
      progressLabel: "project completed",
      editable: true,
    });
  }

  const liquid = state.accounts
    .filter((account) => ["Checking", "Cash"].includes(account.type))
    .reduce((sum, account) => sum + Math.max(0, account.available), 0);
  buckets.push({
    id: "protected-buffer",
    sourceId: "protected-buffer",
    kind: "buffer",
    group: "Protection",
    name: "Cash buffer",
    assigned: state.profile.minimumBuffer,
    progressCurrent: Math.min(liquid, state.profile.minimumBuffer),
    progressTarget: state.profile.minimumBuffer,
    percent: bucketPercent(Math.min(liquid, state.profile.minimumBuffer), state.profile.minimumBuffer),
    progressLabel: "currently protected",
    editable: true,
  });

  return buckets;
}

export function paycheckAllocation(state: StewardState) {
  const plan = state.paycheckPlan;
  const income = plan.actual || plan.expected;
  const upcomingBills = state.bills
    .filter((bill) => isDueBefore(bill, state.profile.nextPayday))
    .reduce((sum, bill) => sum + bill.amount, 0);
  const assigned =
    upcomingBills +
    plan.savings +
    plan.debt +
    plan.groceries +
    plan.transportation +
    plan.dining +
    plan.buffer +
    plan.projects;
  return {
    income,
    upcomingBills,
    assigned,
    remaining: income - assigned,
    percentAssigned: income > 0 ? Math.min(100, (assigned / income) * 100) : 0,
  };
}

export function debtPayoffPlan(state: StewardState) {
  const debts = state.accounts
    .filter(
      (account) =>
        ["Credit card", "Loan"].includes(account.type) && account.balance > 0,
    )
    .map((account) => ({
      id: account.id,
      name: account.name,
      balance: account.balance,
      apr: account.interestRate ?? 0,
      hasInterestRate: account.interestRate !== undefined,
      minimum: account.minimumPayment ?? 0,
      dueDate: account.dueDate,
    }))
    .sort((a, b) => b.apr - a.apr || a.balance - b.balance);
  const paychecksPerMonth =
    state.profile.payFrequency === "Weekly"
      ? 52 / 12
      : state.profile.payFrequency === "Biweekly"
        ? 26 / 12
        : 1;
  const extraPerMonth = Math.max(0, state.paycheckPlan.debt * paychecksPerMonth);
  const minimumPayments = debts.reduce((sum, debt) => sum + debt.minimum, 0);
  const totalBalance = debts.reduce((sum, debt) => sum + debt.balance, 0);
  const missingTerms = debts.filter(
    (debt) => debt.minimum <= 0 || !debt.hasInterestRate,
  );

  if (!debts.length || missingTerms.length) {
    return {
      debts,
      totalBalance,
      minimumPayments,
      extraPerMonth,
      target: debts[0],
      estimatedMonths: null,
      estimatedInterest: null,
      missingTerms,
    };
  }

  // Educational avalanche projection: cover each recorded minimum, then send
  // the remaining planned payment to the highest APR balance. It is an estimate
  // only—issuers can change rates, minimums, and fees.
  const balances = debts.map((debt) => ({ ...debt }));
  const totalMonthlyPayment = minimumPayments + extraPerMonth;
  let interestPaid = 0;
  let months = 0;
  while (balances.some((debt) => debt.balance > 0.01) && months < 600) {
    months += 1;
    for (const debt of balances) {
      if (debt.balance > 0) {
        const interest = debt.balance * (debt.apr / 100 / 12);
        debt.balance += interest;
        interestPaid += interest;
      }
    }
    let available = totalMonthlyPayment;
    for (const debt of balances) {
      const payment = Math.min(debt.balance, debt.minimum);
      debt.balance -= payment;
      available -= payment;
    }
    const target = balances.find((debt) => debt.balance > 0.01);
    if (!target || available <= 0) continue;
    target.balance -= Math.min(target.balance, available);
  }
  const paidOff = balances.every((debt) => debt.balance <= 0.01);
  return {
    debts,
    totalBalance,
    minimumPayments,
    extraPerMonth,
    target: debts[0],
    estimatedMonths: paidOff ? months : null,
    estimatedInterest: paidOff ? interestPaid : null,
    missingTerms,
  };
}

export function splitIsValid(
  transactionAmount: number,
  splits: { amount: number }[],
) {
  const total = splits.reduce((sum, split) => sum + split.amount, 0);
  return Math.abs(total - transactionAmount) < 0.01;
}

export function deterministicCategory(merchant: string, description = "") {
  const text = `${merchant} ${description}`.toLowerCase();
  const rules: [RegExp, string][] = [
    [/payroll|salary|deposit/, "Paycheck"],
    [/rent|property/, "Housing"],
    [/whole foods|aldi|kroger|grocery|market/, "Groceries"],
    [/shell|exxon|chevron|fuel/, "Transportation"],
    [/netflix|spotify|hulu|cinema/, "Entertainment"],
    [/restaurant|coffee|cafe|pizza|grill/, "Dining"],
    [/electric|water|internet|utility/, "Utilities"],
    [/visa|mastercard|card payment/, "Debt payments"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? "Uncategorized";
}
