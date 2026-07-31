import type {
  Account,
  Bill,
  Budget,
  Recommendation,
  Review,
  StewardState,
  Transaction,
} from "./steward-types";

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
      status: "connected",
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
  return "Uncategorized";
}

function mapTransaction(transaction: PlaidTransaction): Transaction {
  const category = categoryForPlaid(transaction);
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
    category,
    type: transfer ? "transfer" : transaction.amount < 0 ? "income" : "expense",
    pending: transaction.pending ?? false,
    confidence:
      transaction.personal_finance_category?.confidence_level === "VERY_HIGH"
        ? 0.99
        : transaction.personal_finance_category?.confidence_level === "HIGH"
          ? 0.9
          : 0.75,
    needsReview: category === "Uncategorized",
  };
}

function billFrequency(value?: string): Bill["frequency"] {
  const frequency = value?.toUpperCase() ?? "";
  if (frequency.includes("WEEKLY") && !frequency.includes("BIWEEKLY")) {
    return "weekly";
  }
  if (frequency.includes("BIWEEKLY") || frequency.includes("SEMI_MONTHLY")) {
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

function deriveBudgets(transactions: Transaction[], today: Date): Budget[] {
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
  return [...totals.entries()]
    .map(([category, total]) => ({
      id: `derived-budget-${category.toLowerCase().replaceAll(" ", "-")}`,
      category,
      planned: Math.round(total.planned),
      actual: Math.round(total.actual * 100) / 100,
      cadence: "Monthly" as const,
      essential: [
        "Housing",
        "Utilities",
        "Groceries",
        "Transportation",
        "Healthcare",
        "Debt payments",
      ].includes(category),
    }))
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
  const incoming = [...changes.added, ...changes.modified].map(mapTransaction);
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
    paycheck?.predicted_next_date ?? state.profile.nextPayday;

  const nextState: StewardState = {
    ...state,
    profile: {
      ...state.profile,
      takeHomePay: payAmount,
      nextPayday,
      payFrequency: paycheck
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
    budgets: deriveBudgets(transactions, today),
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
