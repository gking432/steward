export type AccountType =
  | "Checking"
  | "Savings"
  | "Credit card"
  | "Loan"
  | "Investment"
  | "Cash"
  | "Other";

export type NavView =
  | "home"
  | "plan"
  | "debt"
  | "transactions"
  | "projects"
  | "wishlist"
  | "advisor"
  | "reviews"
  | "accounts"
  | "settings";

export type Account = {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  balance: number;
  available: number;
  creditLimit?: number;
  interestRate?: number;
  minimumPayment?: number;
  dueDate?: string;
  source: "manual" | "plaid";
  status: "connected" | "manual" | "attention";
  lastSynced: string;
  archived?: boolean;
};

export type Transaction = {
  id: string;
  plaidTransactionId?: string;
  source?: "manual" | "plaid";
  accountId: string;
  merchant: string;
  description: string;
  amount: number;
  date: string;
  category: string;
  subcategory?: string;
  type: "expense" | "income" | "transfer";
  pending?: boolean;
  recurring?: boolean;
  excluded?: boolean;
  tags?: string[];
  note?: string;
  confidence?: number;
  categorySource?: "plaid" | "rule" | "learned" | "manual";
  needsReview?: boolean;
  split?: { category: string; amount: number }[];
};

export type Bill = {
  id: string;
  name: string;
  amount: number;
  dueDate: string;
  frequency: "monthly" | "weekly" | "biweekly" | "annual" | "one-time";
  autopay: boolean;
  essential: boolean;
  accountId: string;
  paid?: boolean;
};

export type Goal = {
  id: string;
  name: string;
  type: string;
  target: number;
  current: number;
  targetDate: string;
  priority: "High" | "Medium" | "Low";
  status: "Active" | "Paused" | "Complete";
  recommendedContribution: number;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  category: string;
  priority: "High" | "Medium" | "Low";
  status: "Active" | "Planned" | "Paused" | "Completed";
  targetDate: string;
  estimatedCost: number;
  actualCost: number;
  progress: number;
  nextAction: string;
  tasks: { id: string; title: string; complete: boolean }[];
};

export type WishlistItem = {
  id: string;
  name: string;
  projectId?: string;
  category: string;
  priority: "High" | "Medium" | "Low";
  price: number;
  desiredDate: string;
  safeDate: string;
  status:
    | "Considering"
    | "Planned"
    | "Recommended now"
    | "Wait"
    | "Purchased"
    | "Rejected";
  reason: string;
  url?: string;
};

export type Recommendation = {
  id: string;
  title: string;
  description: string;
  type: "protect" | "save" | "debt" | "spend" | "review";
  priority: "now" | "soon" | "optional";
  impact: number;
  confidence: number;
  reason: string;
  action: string;
  status: "active" | "completed" | "dismissed" | "snoozed";
  tradeoffs?: string;
  timing?: string;
  expectedOutcome?: string;
  relatedProjectId?: string;
  relatedGoalId?: string;
};

export type FinancialHealth = {
  status: "Stable" | "Watch spending" | "Immediate attention" | "Needs connection";
  tone: "stable" | "watch" | "attention" | "setup";
  summary: string;
};

export type FinancialBottleneck = {
  type: "cash" | "debt" | "savings" | "bills" | "spending" | "income" | "clear";
  title: string;
  reason: string;
  impact: number;
  action: string;
};

export type DailyDecision = {
  title: string;
  reason: string;
  impact: number;
  confidence: number;
  expectedOutcome: string;
  timing: string;
  action: string;
};

export type AffordabilityDecision = {
  verdict: "BUY" | "WAIT" | "DO NOT BUY";
  reason: string;
  tradeoffs: string;
  risk: "Low" | "Moderate" | "High";
  impact: number;
  suggestedDate: string;
  alternative: string;
  confidence: "High" | "Medium";
};

export type PaycheckPlan = {
  date: string;
  expected: number;
  actual: number;
  savings: number;
  debt: number;
  groceries: number;
  transportation: number;
  dining: number;
  buffer: number;
  projects: number;
};

export type Budget = {
  id: string;
  category: string;
  planned: number;
  actual: number;
  cadence: "Monthly" | "Biweekly";
  essential: boolean;
  source?: "suggested" | "manual";
};

export type Memory = {
  id: string;
  label: string;
  value: string;
  category: "Preference" | "Rule" | "Priority" | "Context";
};

export type Review = {
  id: string;
  period: string;
  type: "weekly" | "monthly";
  income: number;
  spending: number;
  savingsChange: number;
  debtChange: number;
  wins: string[];
  focus: string;
};

export type NotificationItem = {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
  type: "bill" | "goal" | "recommendation" | "sync";
};

export type StewardState = {
  version: number;
  profile: {
    name: string;
    email: string;
    currency: "USD" | "EUR" | "GBP" | "CAD";
    nextPayday: string;
    payFrequency: "Weekly" | "Biweekly" | "Monthly";
    takeHomePay: number;
    minimumBuffer: number;
    riskTolerance: "Cautious" | "Balanced" | "Flexible";
    budgetingStyle: "Paycheck plan" | "Monthly" | "Weekly";
    theme: "light" | "dark" | "system";
    onboardingComplete: boolean;
  };
  accounts: Account[];
  transactions: Transaction[];
  bills: Bill[];
  goals: Goal[];
  projects: Project[];
  wishlist: WishlistItem[];
  recommendations: Recommendation[];
  paycheckPlan: PaycheckPlan;
  budgets: Budget[];
  memories: Memory[];
  reviews: Review[];
  notifications: NotificationItem[];
  notificationPreferences: Record<string, boolean>;
};

export type TradeoffResult = {
  liquidCash: number;
  billsBeforePayday: number;
  requiredDebt: number;
  savingsCommitment: number;
  safeToSpend: number;
  availableCash: number;
  risk: "Low" | "Moderate" | "High";
  expectedBalance: number;
  reasons: string[];
  assumptions: string[];
};
