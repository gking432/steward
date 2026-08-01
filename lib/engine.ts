import type {
  Bill,
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
