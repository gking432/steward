import type {
  AffordabilityDecision,
  Bill,
  DailyDecision,
  FinancialBottleneck,
  FinancialHealth,
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
    availableCash: safeToSpend,
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

export function financialHealth(state: StewardState): FinancialHealth {
  if (!state.accounts.some((account) => !account.archived)) {
    return {
      status: "Needs connection",
      tone: "setup",
      summary: "Connect a bank so Steward can determine where you stand.",
    };
  }
  const cash = calculateTradeoffs(state);
  if (cash.risk === "High") {
    return {
      status: "Immediate attention",
      tone: "attention",
      summary:
        cash.expectedBalance < 0
          ? `You are ${money(Math.abs(cash.expectedBalance))} short of covering the current plan before payday.`
          : "Your obligations are covered, but there is no flexible cash left before payday.",
    };
  }
  if (cash.risk === "Moderate") {
    return {
      status: "Watch spending",
      tone: "watch",
      summary: "Bills are covered, but your protected cash buffer is getting tight.",
    };
  }
  return {
    status: "Stable",
    tone: "stable",
    summary: "Upcoming obligations are covered and your cash buffer remains protected.",
  };
}

export function primaryBottleneck(state: StewardState): FinancialBottleneck {
  const cash = calculateTradeoffs(state);
  if (
    !state.profile.nextPayday ||
    (state.profile.takeHomePay <= 0 &&
      state.paycheckPlan.expected <= 0 &&
      state.paycheckPlan.actual <= 0)
  ) {
    return {
      type: "income",
      title: "Paycheck timing is unclear",
      reason: "Steward needs a recurring deposit or payday to judge decisions across the full cash-flow cycle.",
      impact: 0,
      action: "Confirm income timing",
    };
  }
  if (cash.risk === "High") {
    const shortage = Math.max(0, -cash.expectedBalance);
    return {
      type: "cash",
      title: shortage > 0 ? "A cash gap before payday" : "No flexible cash before payday",
      reason: shortage > 0
        ? `${money(shortage)} of the current plan is not covered by available cash.`
        : "Bills, debt minimums, savings, and your buffer use all currently available cash.",
      impact: shortage,
      action: "Protect cash",
    };
  }
  const highInterestDebt = state.accounts
    .filter((account) => ["Credit card", "Loan"].includes(account.type) && account.balance > 0)
    .sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0))[0];
  if (highInterestDebt && (highInterestDebt.interestRate ?? 0) >= 15) {
    return {
      type: "debt",
      title: `${highInterestDebt.name} is costing you the most`,
      reason: `${(highInterestDebt.interestRate ?? 0).toFixed(1)}% APR makes this the highest-cost balance in your plan.`,
      impact: highInterestDebt.balance * ((highInterestDebt.interestRate ?? 0) / 100 / 12),
      action: "Prioritize this debt",
    };
  }
  const overBudget = state.budgets
    .filter((budget) => budget.planned > 0 && budget.actual > budget.planned)
    .sort((a, b) => (b.actual - b.planned) - (a.actual - a.planned))[0];
  if (overBudget) {
    return {
      type: "spending",
      title: `${overBudget.category} is over plan`,
      reason: `${money(overBudget.actual - overBudget.planned)} more has been spent than intended this month.`,
      impact: overBudget.actual - overBudget.planned,
      action: "Adjust this category",
    };
  }
  const emergencyGoal = state.goals.find((goal) =>
    `${goal.name} ${goal.type}`.toLowerCase().includes("emergency"),
  );
  if (emergencyGoal && emergencyGoal.current < emergencyGoal.target) {
    return {
      type: "savings",
      title: "Emergency savings is the weak spot",
      reason: `${money(emergencyGoal.target - emergencyGoal.current)} remains before the fund reaches its target.`,
      impact: emergencyGoal.target - emergencyGoal.current,
      action: "Strengthen the buffer",
    };
  }
  const largestBill = state.bills
    .filter((bill) => isDueBefore(bill, state.profile.nextPayday))
    .sort((a, b) => b.amount - a.amount)[0];
  if (largestBill && largestBill.amount > cash.availableCash) {
    return {
      type: "bills",
      title: `${largestBill.name} is the next pressure point`,
      reason: `${money(largestBill.amount)} is due before the next paycheck.`,
      impact: largestBill.amount,
      action: "Keep it reserved",
    };
  }
  return {
    type: "clear",
    title: "No urgent bottleneck",
    reason: "The current plan has no single issue that needs immediate correction.",
    impact: 0,
    action: "Stay the course",
  };
}

export function dailyDecision(state: StewardState): DailyDecision {
  const cash = calculateTradeoffs(state);
  const bottleneck = primaryBottleneck(state);
  const recommendation = state.recommendations.find((item) => item.status === "active");
  if (!state.accounts.some((account) => !account.archived)) {
    return {
      title: "Connect your bank",
      reason: "Steward needs real balances and activity before it can recommend a financial move.",
      impact: 0,
      confidence: 1,
      expectedOutcome: "Your first decision brief appears as soon as the initial sync completes.",
      timing: "One-time setup",
      action: "Connect bank",
    };
  }
  if (recommendation) {
    return {
      title: recommendation.title,
      reason: recommendation.reason || recommendation.description,
      impact: recommendation.impact,
      confidence: recommendation.confidence,
      expectedOutcome: recommendation.expectedOutcome ?? recommendation.description,
      timing: recommendation.timing ?? (recommendation.priority === "now" ? "Today" : "This paycheck"),
      action: recommendation.action,
    };
  }
  if (bottleneck.type === "debt") {
    return {
      title: `Send ${money(state.paycheckPlan.debt)} extra to your highest-rate debt`,
      reason: bottleneck.reason,
      impact: state.paycheckPlan.debt,
      confidence: 0.94,
      expectedOutcome: "The most expensive balance falls faster without changing recorded minimums.",
      timing: "This paycheck",
      action: "Review debt plan",
    };
  }
  if (cash.risk === "High") {
    return {
      title: "Pause flexible spending until payday",
      reason: bottleneck.reason,
      impact: Math.max(0, -cash.expectedBalance),
      confidence: 0.98,
      expectedOutcome: "Upcoming obligations and the protected buffer receive priority.",
      timing: "Today",
      action: "Review the plan",
    };
  }
  return {
    title: "Keep today simple",
    reason: "Your obligations are covered and no urgent correction is needed.",
    impact: cash.availableCash,
    confidence: 0.91,
    expectedOutcome: "You stay on track without creating unnecessary financial work.",
    timing: "Today",
    action: "Stay the course",
  };
}

export function affordabilityDecision(
  state: StewardState,
  price: number,
): AffordabilityDecision {
  const cash = calculateTradeoffs(state);
  const remaining = cash.availableCash - Math.max(0, price);
  const nextPayday = state.profile.nextPayday || "your next paycheck";
  if (!state.accounts.some((account) => !account.archived)) {
    return {
      verdict: "DO NOT BUY",
      reason: "Steward cannot verify this purchase until a bank account is connected.",
      tradeoffs: "Balances, obligations, and cash reserves are still unknown.",
      risk: "High",
      impact: price,
      suggestedDate: "After connecting your bank",
      alternative: "Connect your bank, then run the decision again.",
      confidence: "High",
    };
  }
  if (price <= 0) {
    return {
      verdict: "DO NOT BUY",
      reason: "A valid purchase price is needed before Steward can evaluate the decision.",
      tradeoffs: "No financial tradeoff has been calculated.",
      risk: "High",
      impact: 0,
      suggestedDate: "After adding a price",
      alternative: "Add the expected total cost, including tax and delivery.",
      confidence: "High",
    };
  }
  if (cash.risk === "High" || price > cash.availableCash) {
    const gap = Math.max(0, price - cash.availableCash);
    return {
      verdict: price > cash.availableCash * 1.5 || cash.availableCash === 0 ? "DO NOT BUY" : "WAIT",
      reason: `${money(price)} is more than the ${money(cash.availableCash)} currently available after obligations and reserves.`,
      tradeoffs: "Buying now would use protected money or leave current obligations underfunded.",
      risk: "High",
      impact: gap,
      suggestedDate: nextPayday,
      alternative: gap > 0 ? `Set aside ${money(gap)} more before buying.` : "Revisit after the cash position improves.",
      confidence: "High",
    };
  }
  if (cash.risk === "Moderate" || remaining < state.profile.minimumBuffer * 0.25) {
    return {
      verdict: "WAIT",
      reason: "The purchase fits mathematically, but it would leave very little flexibility before payday.",
      tradeoffs: `Available cash would fall from ${money(cash.availableCash)} to ${money(remaining)}.`,
      risk: "Moderate",
      impact: price,
      suggestedDate: nextPayday,
      alternative: `Wait until ${nextPayday} or choose an option below ${money(Math.max(0, cash.availableCash * 0.35))}.`,
      confidence: "High",
    };
  }
  return {
    verdict: "BUY",
    reason: "Upcoming bills, required debt payments, savings, and your cash buffer remain protected.",
    tradeoffs: `Available cash would move from ${money(cash.availableCash)} to ${money(remaining)}.`,
    risk: "Low",
    impact: price,
    suggestedDate: "Today",
    alternative: "Buy only if the item still matters at the current price.",
    confidence: state.profile.nextPayday ? "High" : "Medium",
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
      estimatedInterestSaved: null,
      missingTerms,
    };
  }

  // Educational avalanche projection: cover each recorded minimum, then send
  // the remaining planned payment to the highest APR balance. It is an estimate
  // only—issuers can change rates, minimums, and fees.
  const totalMonthlyPayment = minimumPayments + extraPerMonth;
  const project = (monthlyPayment: number) => {
    const balances = debts.map((debt) => ({ ...debt }));
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
      let available = monthlyPayment;
      for (const debt of balances) {
        const payment = Math.min(debt.balance, debt.minimum);
        debt.balance -= payment;
        available -= payment;
      }
      const target = balances.find((debt) => debt.balance > 0.01);
      if (!target || available <= 0) continue;
      target.balance -= Math.min(target.balance, available);
    }
    return {
      paidOff: balances.every((debt) => debt.balance <= 0.01),
      months,
      interestPaid,
    };
  };
  const currentProjection = project(totalMonthlyPayment);
  const minimumProjection = extraPerMonth > 0 ? project(minimumPayments) : currentProjection;
  return {
    debts,
    totalBalance,
    minimumPayments,
    extraPerMonth,
    target: debts[0],
    estimatedMonths: currentProjection.paidOff ? currentProjection.months : null,
    estimatedInterest: currentProjection.paidOff ? currentProjection.interestPaid : null,
    estimatedInterestSaved:
      currentProjection.paidOff && minimumProjection.paidOff
        ? Math.max(0, minimumProjection.interestPaid - currentProjection.interestPaid)
        : null,
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
