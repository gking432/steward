import type {
  Account,
  Bill,
  Budget,
  Recommendation,
  Review,
  StewardState,
  Transaction,
} from "./steward-types";
import { deterministicCategory } from "./engine";

export type PlaidAccount = {
  account_id: string;
  name: string;
  official_name?: string | null;
  type: string;
  subtype?: string | null;
  balances: {
    current: number | null;
    available: number | null;
    limit: number | null;
  };
};

export type PlaidTransaction = {
  transaction_id: string;
  pending_transaction_id?: string | null;
  account_id: string;
  name: string;
  merchant_name?: string | null;
  original_description?: string | null;
  amount: number;
  date: string;
  pending?: boolean;
  personal_finance_category?: {
    primary?: string | null;
    detailed?: string | null;
    confidence_level?: string | null;
  } | null;
};

export type PlaidRecurringStream = {
  stream_id: string;
  account_id: string;
  description: string;
  merchant_name?: string | null;
  is_active?: boolean;
  frequency?: string;
  predicted_next_date?: string | null;
  average_amount?: { amount: number };
  last_amount?: { amount: number };
  personal_finance_category?: {
    primary?: string | null;
    detailed?: string | null;
  } | null;
};

export type PlaidRecurring = {
  inflow_streams?: PlaidRecurringStream[];
  outflow_streams?: PlaidRecurringStream[];
};

function accountType(account: PlaidAccount): Account["type"] {
  if (account.type === "depository") {
    return account.subtype === "savings" ? "Savings" : "Checking";
  }
  if (account.type === "credit") return "Credit card";
  if (account.type === "investment") return "Investment";
  if (account.type === "loan") return "Loan";
  return "Other";
}

export function mergePlaidAccounts(
  state: StewardState,
  accounts: PlaidAccount[],
  institution: string,
): StewardState {
  const now = new Date().toISOString();
  const mapped: Account[] = accounts.map((account) => {
    const id = `plaid-${account.account_id}`;
    const previous = state.accounts.find((candidate) => candidate.id === id);
    return {
      ...previous,
      id,
      name: account.name,
      institution: institution || previous?.institution || "Connected institution",
      type: accountType(account),
      balance: account.balances.current ?? 0,
      available:
        account.balances.available ?? account.balances.current ?? 0,
      creditLimit: account.balances.limit ?? undefined,
      source: "plaid",
      status: account.balances.available == null && accountType(account) === "Checking" ? "attention" : "connected",
      lastSynced: now,
      archived: false,
    };
  });
  const connectedIds = new Set(mapped.map((account) => account.id));
  return {
    ...state,
    profile: { ...state.profile, onboardingComplete: true },
    accounts: [
      ...state.accounts.filter((account) => !connectedIds.has(account.id)),
      ...mapped,
    ],
  };
}

export function categoryForPlaid(transaction: PlaidTransaction) {
  const primary =
    transaction.personal_finance_category?.primary?.toUpperCase() ?? "";
  const detailed =
    transaction.personal_finance_category?.detailed?.toUpperCase() ?? "";
  if (primary === "INCOME") return "Paycheck";
  if (primary === "RENT_AND_UTILITIES") {
    return detailed.includes("RENT") ? "Housing" : "Utilities";
  }
  if (primary === "FOOD_AND_DRINK") {
    return detailed.includes("GROCER") ? "Groceries" : "Dining";
  }
  if (primary === "TRANSPORTATION") return "Transportation";
  if (primary === "MEDICAL") return "Healthcare";
  if (primary === "GENERAL_MERCHANDISE") return "Shopping";
  if (primary === "ENTERTAINMENT") return "Entertainment";
  if (primary === "TRAVEL") return "Travel";
  if (primary === "PERSONAL_CARE") return "Personal care";
  if (primary === "LOAN_PAYMENTS") return "Debt payments";
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") return "Transfers";
  if (primary === "BANK_FEES") return "Fees";
  if (primary.includes("GOVERNMENT")) return "Taxes";
  return deterministicCategory(
    transaction.merchant_name ?? transaction.name,
    transaction.original_description ?? "",
  );
}

function categorySourceFor(transaction: PlaidTransaction) {
  const primary =
    transaction.personal_finance_category?.primary?.toUpperCase() ?? "";
  const plaidPrimaryCategories = new Set([
    "INCOME",
    "RENT_AND_UTILITIES",
    "FOOD_AND_DRINK",
    "TRANSPORTATION",
    "MEDICAL",
    "GENERAL_MERCHANDISE",
    "ENTERTAINMENT",
    "TRAVEL",
    "PERSONAL_CARE",
    "LOAN_PAYMENTS",
    "TRANSFER_IN",
    "TRANSFER_OUT",
    "BANK_FEES",
  ]);
  return primary.includes("GOVERNMENT") || plaidPrimaryCategories.has(primary)
    ? "plaid"
    : "rule";
}

function merchantKey(merchant: string) {
  return merchant.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rememberedCategories(transactions: Transaction[]) {
  const learned = new Map<string, string>();
  for (const transaction of [...transactions].sort((a, b) => b.date.localeCompare(a.date))) {
    if (
      transaction.categorySource === "manual" &&
      transaction.category !== "Uncategorized"
    ) {
      learned.set(merchantKey(transaction.merchant), transaction.category);
    }
  }
  return learned;
}

function mapTransaction(
  transaction: PlaidTransaction,
  learned: Map<string, string>,
): Transaction {
  const category = categoryForPlaid(transaction);
  const remembered = learned.get(
    merchantKey(transaction.merchant_name ?? transaction.name),
  );
  const resolvedCategory = remembered ?? category;
  const transfer = category === "Transfers";
  return {
    id: `plaid-tx-${transaction.transaction_id}`,
    plaidTransactionId: transaction.transaction_id,
    source: "plaid",
    accountId: `plaid-${transaction.account_id}`,
    merchant: transaction.merchant_name ?? transaction.name,
    description:
      transaction.original_description ??
      transaction.name ??
      transaction.merchant_name ??
      "Transaction",
    amount: Math.abs(transaction.amount),
    date: transaction.date,
    category: resolvedCategory,
    type: transfer ? "transfer" : transaction.amount < 0 ? "income" : "expense",
    pending: transaction.pending ?? false,
    confidence: remembered
      ? 1
      : transaction.personal_finance_category?.confidence_level === "VERY_HIGH"
        ? 0.99
        : transaction.personal_finance_category?.confidence_level === "HIGH"
          ? 0.9
          : 0.75,
    categorySource: remembered ? "learned" : categorySourceFor(transaction),
    needsReview: resolvedCategory === "Uncategorized",
  };
}

function billFrequency(value?: string): Bill["frequency"] {
  const frequency = value?.toUpperCase() ?? "";
  if (frequency.includes("SEMI_MONTHLY")) return "one-time";
  if (frequency.includes("WEEKLY") && !frequency.includes("BIWEEKLY")) {
    return "weekly";
  }
  if (frequency.includes("BIWEEKLY")) {
    return "biweekly";
  }
  if (frequency.includes("ANNUAL")) return "annual";
  return "monthly";
}

function recurringBills(streams: PlaidRecurringStream[] | undefined): Bill[] {
  return (streams ?? [])
    .filter(
      (stream) =>
        stream.is_active !== false &&
        stream.predicted_next_date &&
        (stream.average_amount?.amount ?? stream.last_amount?.amount ?? 0) > 0,
    )
    .map((stream) => {
      const primary =
        stream.personal_finance_category?.primary?.toUpperCase() ?? "";
      return {
        id: `plaid-bill-${stream.stream_id}`,
        name: stream.merchant_name ?? stream.description,
        amount: Math.abs(
          stream.average_amount?.amount ?? stream.last_amount?.amount ?? 0,
        ),
        dueDate: stream.predicted_next_date!,
        frequency: billFrequency(stream.frequency),
        autopay: false,
        essential:
          primary === "RENT_AND_UTILITIES" ||
          primary === "LOAN_PAYMENTS" ||
          primary === "MEDICAL",
        accountId: `plaid-${stream.account_id}`,
      };
    });
}

function monthlyAmount(amount: number, frequency: Bill["frequency"]) {
  if (frequency === "weekly") return (amount * 52) / 12;
  if (frequency === "biweekly") return (amount * 26) / 12;
  if (frequency === "annual") return amount / 12;
  return amount;
}

function monthlyIncome(state: StewardState) {
  const amount = state.profile.takeHomePay;
  if (state.profile.payFrequency === "Weekly") return (amount * 52) / 12;
  if (state.profile.payFrequency === "Biweekly") return (amount * 26) / 12;
  return amount;
}

export function suggestBudgets(
  state: StewardState,
  transactions = state.transactions,
  bills = state.bills,
  today = new Date(),
): Budget[] {
  const ninetyDaysAgo = new Date(today);
  ninetyDaysAgo.setDate(today.getDate() - 90);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const totals = new Map<string, { planned: number; actual: number }>();
  for (const transaction of transactions) {
    if (
      transaction.type !== "expense" ||
      transaction.excluded ||
      transaction.pending ||
      transaction.category === "Transfers"
    ) {
      continue;
    }
    const date = new Date(`${transaction.date}T12:00:00`);
    if (date < ninetyDaysAgo) continue;
    const current = totals.get(transaction.category) ?? {
      planned: 0,
      actual: 0,
    };
    current.planned += transaction.amount / 3;
    if (date >= monthStart) current.actual += transaction.amount;
    totals.set(transaction.category, current);
  }
  const essentials = new Set([
    "Housing",
    "Utilities",
    "Groceries",
    "Transportation",
    "Healthcare",
    "Debt payments",
  ]);
  const income = monthlyIncome(state);
  const recurringBills = bills
    .filter((bill) => !bill.paid)
    .reduce((sum, bill) => sum + monthlyAmount(bill.amount, bill.frequency), 0);
  const hasHobbyPriority =
    state.projects.some((project) => project.category === "Hobby") ||
    state.wishlist.some((item) => item.category === "Hobbies");
  if (hasHobbyPriority && income > recurringBills && !totals.has("Hobbies")) {
    totals.set("Hobbies", { planned: 0, actual: 0 });
  }

  const suggested = [...totals.entries()].map(([category, total]) => ({
      id: `derived-budget-${category.toLowerCase().replaceAll(" ", "-")}`,
      category,
      planned: Math.round(total.planned),
      actual: Math.round(total.actual * 100) / 100,
      cadence: "Monthly" as const,
      essential: essentials.has(category),
      source: "suggested" as const,
    }));

  // Bills are reserved before flexible categories. When income is known, cap
  // suggested discretionary spending to what remains after bills and recent
  // essential spending. A stated hobby gets a modest visible lane even before
  // enough history has accumulated.
  if (income > 0) {
    const essentialSpending = suggested
      .filter((budget) => budget.essential)
      .reduce((sum, budget) => sum + budget.planned, 0);
    const flexible = suggested.filter((budget) => !budget.essential);
    const allowance = Math.max(0, income - recurringBills - essentialSpending);
    const flexibleTotal = flexible.reduce((sum, budget) => sum + budget.planned, 0);
    if (flexibleTotal > allowance && flexibleTotal > 0) {
      for (const budget of flexible) {
        budget.planned = Math.floor((budget.planned / flexibleTotal) * allowance);
      }
    }
    const hobbies = suggested.find((budget) => budget.category === "Hobbies");
    if (hobbies && hobbies.planned === 0) {
      const unused = Math.max(0, allowance - flexible.reduce((sum, budget) => sum + budget.planned, 0));
      hobbies.planned = Math.round(Math.min(100, unused * 0.1));
    }
  }

  const manual = state.budgets.filter((budget) => budget.source === "manual");
  const manualCategories = new Set(manual.map((budget) => budget.category));
  return [...manual, ...suggested.filter((budget) => !manualCategories.has(budget.category))]
    .sort((a, b) => b.actual - a.actual);
}

function deriveRecommendations(
  state: StewardState,
  transactions: Transaction[],
  bills: Bill[],
  today: Date,
): Recommendation[] {
  const result: Recommendation[] = [];
  const inThirtyDays = new Date(today);
  inThirtyDays.setDate(today.getDate() + 30);
  const upcoming = bills.filter((bill) => {
    const due = new Date(`${bill.dueDate}T12:00:00`);
    return !bill.paid && due >= today && due <= inThirtyDays;
  });
  const upcomingTotal = upcoming.reduce((sum, bill) => sum + bill.amount, 0);
  if (upcomingTotal > 0) {
    result.push({
      id: "derived-protect-upcoming",
      title: "Protect upcoming bills",
      description: `${upcoming.length} recurring ${upcoming.length === 1 ? "payment is" : "payments are"} predicted in the next 30 days.`,
      type: "protect",
      priority: "now",
      impact: upcomingTotal,
      confidence: 0.9,
      reason: "Derived from recurring activity reported by your institution.",
      action: "Review the bill plan",
      status: "active",
    });
  }
  const reviewCount = transactions.filter((item) => item.needsReview).length;
  if (reviewCount > 0) {
    result.push({
      id: "derived-review-categories",
      title: "Review uncategorized activity",
      description: `${reviewCount} ${reviewCount === 1 ? "transaction needs" : "transactions need"} a category before the plan is complete.`,
      type: "review",
      priority: upcomingTotal ? "soon" : "now",
      impact: 0,
      confidence: 1,
      reason: "These transactions did not include a category Steward could map.",
      action: "Review transactions",
      status: "active",
    });
  }
  if (state.profile.minimumBuffer <= 0) {
    result.push({
      id: "derived-set-buffer",
      title: "Choose a protected cash buffer",
      description:
        "Set the amount Steward should leave untouched when calculating what is safe to spend.",
      type: "protect",
      priority: "soon",
      impact: 0,
      confidence: 1,
      reason: "No protected cash buffer has been set.",
      action: "Set a buffer",
      status: "active",
    });
  }
  return result;
}

function deriveReview(
  transactions: Transaction[],
  today: Date,
): Review | undefined {
  if (!transactions.length) return undefined;
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const current = transactions.filter(
    (transaction) =>
      new Date(`${transaction.date}T12:00:00`) >= monthStart &&
      !transaction.pending &&
      !transaction.excluded,
  );
  const income = current
    .filter((item) => item.type === "income")
    .reduce((sum, item) => sum + item.amount, 0);
  const spending = current
    .filter((item) => item.type === "expense")
    .reduce((sum, item) => sum + item.amount, 0);
  return {
    id: `derived-review-${today.toISOString().slice(0, 7)}`,
    period: today.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    }),
    type: "monthly",
    income,
    spending,
    savingsChange: income - spending,
    debtChange: 0,
    wins: [],
    focus:
      income || spending
        ? "Keep categorizing activity so Steward can sharpen the plan."
        : "Transaction history is still arriving from your institution.",
  };
}

export function mergePlaidFinancialData(
  state: StewardState,
  changes: {
    added: PlaidTransaction[];
    modified: PlaidTransaction[];
    removed: { transaction_id: string }[];
    recurring?: PlaidRecurring;
  },
  today = new Date(),
): StewardState {
  const removed = new Set(
    changes.removed.map((transaction) => transaction.transaction_id),
  );
  const learned = rememberedCategories(state.transactions);
  const previous = new Map(state.transactions.filter(t=>t.plaidTransactionId).map(t => [t.plaidTransactionId, t]));
  const unique = new Map([...changes.added, ...changes.modified].map(t => [t.transaction_id, t]));
  for (const t of unique.values()) if (t.pending_transaction_id) removed.add(t.pending_transaction_id);
  const incoming = [...unique.values()].map(transaction => {
    const mapped = mapTransaction(transaction, learned);
    const prior = previous.get(transaction.transaction_id) ?? previous.get(transaction.pending_transaction_id ?? undefined);
    if (!prior) return mapped;
    return {...mapped, ...(prior.categorySource === 'manual' ? {category:prior.category,categorySource:prior.categorySource,needsReview:false} : {}), excluded:prior.excluded,note:prior.note,tags:prior.tags,
      ...(prior.split && Math.abs(prior.amount - mapped.amount) < .005 ? {split:prior.split} : prior.split ? {needsReview:true} : {})};
  });
  const incomingIds = new Set(
    incoming.map((transaction) => transaction.plaidTransactionId),
  );
  const transactions = [
    ...state.transactions.filter(
      (transaction) =>
        !removed.has(transaction.plaidTransactionId ?? "") &&
        !incomingIds.has(transaction.plaidTransactionId),
    ),
    ...incoming,
  ].sort((a, b) => b.date.localeCompare(a.date));

  const bills = changes.recurring
    ? [
        ...state.bills.filter((bill) => !bill.id.startsWith("plaid-bill-")),
        ...recurringBills(changes.recurring.outflow_streams),
      ]
    : state.bills;
  const paycheck = (changes.recurring?.inflow_streams ?? [])
    .filter((stream) => stream.is_active !== false)
    .sort(
      (a, b) =>
        (b.average_amount?.amount ?? b.last_amount?.amount ?? 0) -
        (a.average_amount?.amount ?? a.last_amount?.amount ?? 0),
    )[0];
  const payAmount = paycheck
    ? Math.abs(
        paycheck.average_amount?.amount ?? paycheck.last_amount?.amount ?? 0,
      )
    : state.profile.takeHomePay;
  const nextPayday =
    paycheck?.frequency?.toUpperCase().includes("SEMI_MONTHLY") ? "" : paycheck?.predicted_next_date ?? state.profile.nextPayday;

  const nextState: StewardState = {
    ...state,
    profile: {
      ...state.profile,
      takeHomePay: payAmount,
      nextPayday,
      payFrequency: paycheck && !paycheck.frequency?.toUpperCase().includes("SEMI_MONTHLY")
        ? billFrequency(paycheck.frequency) === "weekly"
          ? "Weekly"
          : billFrequency(paycheck.frequency) === "monthly"
            ? "Monthly"
            : "Biweekly"
        : state.profile.payFrequency,
    },
    transactions,
    bills,
    paycheckPlan: {
      ...state.paycheckPlan,
      date: nextPayday,
      expected: payAmount,
    },
    budgets: suggestBudgets({ ...state, transactions, bills }, transactions, bills, today),
  };
  const review = deriveReview(transactions, today);
  return {
    ...nextState,
    recommendations: deriveRecommendations(
      nextState,
      transactions,
      bills,
      today,
    ),
    reviews: review
      ? [
          ...state.reviews.filter((item) => item.id !== review.id),
          review,
        ]
      : state.reviews,
  };
}
