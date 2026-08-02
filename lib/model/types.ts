/**
 * STEWARD DOMAIN MODEL — the eight objects defined in BLUEPRINT.md §A.
 *
 * This model exists alongside the legacy `StewardState` during the redesign.
 * Nothing reads from it yet; `lib/model/convert.ts` maps between the two so the
 * engine can be rebuilt against this shape without touching stored data.
 *
 * The three truths must stay separated (BLUEPRINT.md §0):
 *   Ledger truth  — Transaction
 *   Plan truth    — Cycle, Bucket, Allocation
 *   Path truth    — Claim, Project
 */

import type { Account, Transaction } from "../steward-types";

export type { Account, Transaction };

/* ------------------------------------------------------------------ Cycle */

/**
 * One paycheck period — the planning unit. Runs from one payday up to (but not
 * including) the next.
 */
export type Cycle = {
  id: string;
  /** ISO date of the payday that opens this cycle. */
  start: string;
  /** ISO date of the next payday. Exclusive bound. */
  end: string;
  expectedIncome: number;
  /** Observed income once it lands. Zero until then. */
  actualIncome: number;
  status: "planned" | "active" | "closed";
};

/* ----------------------------------------------------------------- Bucket */

/**
 * `spend`   — refills each cycle, is spent down, resets. Groceries, dining.
 * `reserve` — accumulates toward a dated outflow, discharges, repeats. Rent,
 *             utilities, and debt *minimums* (never elective payoff).
 *
 * Both sit ABOVE the free-capacity line. Neither is ranked: obligations and
 * everyday spending do not compete with what the user is working toward.
 */
export type BucketKind = "spend" | "reserve";

export type Bucket = {
  id: string;
  kind: BucketKind;
  name: string;
  essential: boolean;
  source: "derived" | "manual" | "plaid";

  /** Transaction category this bucket absorbs. Primarily for `spend`. */
  category?: string;

  /** `spend`: the amount assigned each cycle. */
  perCycle?: number;

  /**
   * `spend` only. What happens to an unspent balance at cycle close.
   * Discretionary buckets sweep to the top claim (a visible win); essentials
   * roll forward. BLUEPRINT.md §C7.
   */
  rollover?: "sweep" | "roll";

  /** `reserve`: the full amount owed on `dueDate`. */
  amountDue?: number;
  /** `reserve`: ISO date the money leaves. */
  dueDate?: string;
  /** `reserve`: how much has been set aside so far toward `amountDue`. */
  reserved?: number;
  frequency?: "monthly" | "weekly" | "biweekly" | "annual" | "one-time";
  autopay?: boolean;

  /** Account the outflow is paid from. */
  accountId?: string;
  /**
   * Set when this reserve is a debt account's required minimum. The elective
   * payoff for the same account is a Claim, not a Bucket. BLUEPRINT.md §A.
   */
  linkedDebtAccountId?: string;
};

/* ------------------------------------------------------------------ Claim */

/**
 * Something the user is building toward across cycles. Claims sit BELOW the
 * free-capacity line and are the only ranked objects in the system.
 */
export type ClaimKind = "purchase" | "payoff" | "fund" | "commitment";

export type ClaimStatus = "active" | "someday" | "paused" | "complete";

/** `arrival` gets a date. `commitment` gets a rate and no date. §B4. */
export type ClaimHorizon = "arrival" | "commitment";

/**
 * Why waiting is expensive. Drives the one place Steward may argue with a
 * user's ranking — and it argues exactly once. §C3.2.
 */
export type DelayCost =
  | { type: "none" }
  | { type: "interest"; apr: number }
  | { type: "deadline"; date: string };

export type Claim = {
  id: string;
  name: string;
  kind: ClaimKind;
  projectId?: string;

  /** What completion costs. */
  targetAmount: number;
  /** Sum of confirmed allocations, less withdrawals. Never changed by rank. */
  fundedAmount: number;

  /** Ordinal position among active claims. Lower is higher priority. */
  rank: number;
  status: ClaimStatus;

  /* --- inferred; never surfaced as editable fields (§B2) --- */
  horizon: ClaimHorizon;
  divisible: boolean;
  delayCost: DelayCost;
  /** Funded ahead of the discretionary ranking. Commitments, starter cushion. */
  protected: boolean;

  /**
   * The user's desired date. An INPUT to prioritization.
   * Never confuse this with `arrivalDate`, which the engine owns. §B1.
   */
  wantBy?: string;

  /** User-fixed per-cycle amount, exempt from waterfall reshuffling. §C4. */
  pinned?: number;

  linkedAccountId?: string;
  note?: string;
  url?: string;
};

/* ---------------------------------------------------------------- Project */

/**
 * A named group of Claims. Holds no money of its own — a project's amount is
 * the sum of its children, which is what prevents the double-counting in the
 * legacy model. §A.
 */
export type Project = {
  id: string;
  name: string;
  description?: string;
  category?: string;
};

/* ------------------------------------------------------------- Allocation */

/**
 * The audit record: this much money, to this target, in this cycle.
 *
 * `proposed` allocations are a payday plan awaiting confirmation. They never
 * affect `fundedAmount`. Inaction confirms nothing. BLUEPRINT.md §C10 / A1.
 */
export type Allocation = {
  id: string;
  cycleId: string;
  targetType: "bucket" | "claim";
  targetId: string;
  amount: number;
  status: "proposed" | "confirmed";
  createdAt: string;
};

/* ------------------------------------------------------------------- Rule */

/** A remembered categorization. Surfaced only as "Steward remembers this". */
export type Rule = {
  id: string;
  /** Normalized merchant key. */
  merchantKey: string;
  category: string;
  createdAt: string;
};

/* -------------------------------------------------------------- Workspace */

export type Profile = {
  name: string;
  email: string;
  currency: "USD" | "EUR" | "GBP" | "CAD";
  payFrequency: "Weekly" | "Biweekly" | "Monthly";
  nextPayday: string;
  takeHomePay: number;
  /** The cash floor Steward protects before any discretionary allocation. */
  bufferFloor: number;
  theme: "light" | "dark" | "system";
  onboardingComplete: boolean;
};

export type Workspace = {
  modelVersion: 1;
  profile: Profile;
  accounts: Account[];
  transactions: Transaction[];
  cycles: Cycle[];
  buckets: Bucket[];
  claims: Claim[];
  projects: Project[];
  allocations: Allocation[];
  rules: Rule[];

  /**
   * Legacy passthrough. Holds every legacy field that has no home in this
   * model yet, so conversion is lossless and reversible in both directions.
   *
   * This is what makes the migration safe: we can adopt the new model for
   * reads without ever rewriting stored data. It shrinks as later phases
   * absorb each field, and is deleted at Phase 10.
   */
  legacy: LegacyRemnant;
};

export type LegacyRemnant = {
  version: number;
  riskTolerance: "Cautious" | "Balanced" | "Flexible";
  budgetingStyle: "Paycheck plan" | "Monthly" | "Weekly";
  paycheckPlan: Record<string, number | string>;
  recommendations: unknown[];
  memories: unknown[];
  reviews: unknown[];
  notifications: unknown[];
  notificationPreferences: Record<string, boolean>;
  /** Per-entity fields the new model drops but must restore on the way back. */
  goalMeta: Record<string, unknown>;
  projectMeta: Record<string, unknown>;
  wishlistMeta: Record<string, unknown>;
  budgetMeta: Record<string, unknown>;
  billMeta: Record<string, unknown>;

  /**
   * Original array order per legacy collection. Deep equality is
   * order-sensitive, and several legacy collections collapse into one model
   * collection (goals + wishlist → claims), so order must be recorded
   * explicitly rather than inferred.
   */
  order: {
    bills: string[];
    budgets: string[];
    goals: string[];
    projects: string[];
    wishlist: string[];
  };
};
