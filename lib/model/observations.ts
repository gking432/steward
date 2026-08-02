/**
 * OBSERVATIONS — what Steward can say it already noticed.
 *
 * The onboarding conversation opens each of its factual phases with something
 * Steward worked out on its own ("you get paid $2,150 every two weeks — is that
 * your job?"). That only lands if the fact is true, so every observation here is
 * derived from the transaction ledger by plain arithmetic. Nothing is inferred
 * by a model, and nothing is guessed.
 *
 * Deliberately ledger-based rather than Plaid-based. Plaid's recurring endpoint
 * is a corroborating signal, not the source: deriving from transactions means
 * the manual path gets the same conversation, and it means all of this is
 * testable without credentials.
 *
 * The rule that governs the whole file: an observation Steward is not sure
 * about is not made. A wrong "I noticed..." is worse than no observation,
 * because it tells the user Steward is guessing about their money.
 */

import type { Transaction, Workspace } from "./types";

/** How often a stream recurs. `irregular` means present but not on a schedule. */
export type Cadence = "weekly" | "biweekly" | "monthly" | "irregular";

export type Stream = {
  /** Normalized merchant key — the grouping identity. */
  key: string;
  merchant: string;
  category: string;
  direction: "in" | "out";
  cadence: Cadence;
  /** Median amount. Median, not mean, so one outlier does not move it. */
  typicalAmount: number;
  occurrences: number;
  firstDate: string;
  lastDate: string;
  /** Median gap in days between occurrences. Zero when only seen once. */
  medianGapDays: number;
  /** Amount spread as a fraction of typical. Low means a fixed-price stream. */
  amountVariance: number;
};

const DAY = 86_400_000;

const merchantKey = (merchant: string) => merchant.toLowerCase().replace(/[^a-z0-9]/g, "");

const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / DAY);

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * A gap only counts as a cadence if it is close to the nominal period. The
 * windows are wide enough to absorb weekends and month lengths, and narrow
 * enough that "roughly every three weeks" stays irregular rather than being
 * rounded into a schedule Steward would then plan around.
 */
function cadenceFor(medianGapDays: number, occurrences: number): Cadence {
  if (occurrences < 3) return "irregular";
  if (medianGapDays >= 6 && medianGapDays <= 8) return "weekly";
  if (medianGapDays >= 13 && medianGapDays <= 16) return "biweekly";
  if (medianGapDays >= 28 && medianGapDays <= 32) return "monthly";
  return "irregular";
}

/** Times per year a cadence occurs. `irregular` has no rate, so it returns 0. */
export function perYear(cadence: Cadence) {
  if (cadence === "weekly") return 52;
  if (cadence === "biweekly") return 26;
  if (cadence === "monthly") return 12;
  return 0;
}

/**
 * Group the ledger into per-merchant streams.
 *
 * `windowDays` bounds how far back to look. Ninety days is two to three
 * occurrences of a monthly stream — enough to establish a cadence, recent
 * enough that a subscription cancelled in the spring does not resurface.
 */
export function detectStreams(
  workspace: Workspace,
  today: string,
  windowDays = 90,
): Stream[] {
  const cutoff = new Date(Date.parse(today) - windowDays * DAY).toISOString().slice(0, 10);

  const groups = new Map<string, Transaction[]>();
  for (const transaction of workspace.transactions) {
    // Transfers move money between the user's own accounts. Counting them as
    // income would invent a paycheck out of a savings top-up.
    if (transaction.type === "transfer") continue;
    if (transaction.excluded || transaction.pending) continue;
    if (transaction.date < cutoff || transaction.date > today) continue;

    const key = `${transaction.type}:${merchantKey(transaction.merchant)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(transaction);
    else groups.set(key, [transaction]);
  }

  const streams: Stream[] = [];
  for (const [key, rows] of groups) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const amounts = sorted.map((row) => Math.abs(row.amount));
    const typicalAmount = round2(median(amounts));

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      gaps.push(days(sorted[i - 1].date, sorted[i].date));
    }
    const medianGapDays = Math.round(median(gaps));
    const spread = Math.max(...amounts) - Math.min(...amounts);

    streams.push({
      key,
      merchant: sorted[0].merchant,
      category: sorted[0].category,
      direction: sorted[0].type === "income" ? "in" : "out",
      cadence: cadenceFor(medianGapDays, sorted.length),
      typicalAmount,
      occurrences: sorted.length,
      firstDate: sorted[0].date,
      lastDate: sorted[sorted.length - 1].date,
      medianGapDays,
      amountVariance: typicalAmount > 0 ? round2(spread / typicalAmount) : 0,
    });
  }

  return streams.sort((a, b) => b.typicalAmount - a.typicalAmount);
}

/* ---------------------------------------------------------------- income -- */

export type IncomeObservation = {
  /**
   * The regular, largest inflow — almost always employment. Undefined when no
   * inflow recurs on a schedule, in which case Steward must ask rather than
   * announce.
   */
  primary?: Stream;
  /**
   * Everything else coming in. These are the ones worth a question: a second
   * job, a parent helping out, a side business. Steward cannot tell which, and
   * the difference changes whether the money can be planned around — so it asks
   * instead of assuming.
   */
  others: Stream[];
};

export function incomeObservations(
  workspace: Workspace,
  today: string,
  windowDays = 90,
): IncomeObservation {
  const inflows = detectStreams(workspace, today, windowDays).filter(
    (stream) => stream.direction === "in",
  );
  const scheduled = inflows.filter((stream) => stream.cadence !== "irregular");
  const primary = scheduled[0];
  return {
    primary,
    others: inflows.filter((stream) => stream.key !== primary?.key),
  };
}

/* --------------------------------------------------------- subscriptions -- */

/**
 * Spending that is an obligation, not a discretionary recurring charge. These
 * are modeled as reserve buckets, and offering the user "did you know about
 * this recurring housing charge?" would be absurd.
 */
const OBLIGATION_CATEGORIES = new Set([
  "Housing",
  "Utilities",
  "Insurance",
  "Debt payments",
  "Taxes",
  "Childcare",
  "Healthcare",
]);

/**
 * Regular outflows at a near-fixed price — the streaming, software and
 * membership charges people forget they hold.
 *
 * Excludes anything already covered by a reserve bucket: rent recurs monthly at
 * a fixed price too, and Steward asking "did you know about this Riverside
 * Apartments charge?" would be absurd.
 */
export function subscriptions(
  workspace: Workspace,
  today: string,
  windowDays = 90,
): Stream[] {
  // Matching a reserve bucket to a merchant by name does not work: the bucket
  // is called "Rent" and the charge says "Riverside Apartments". Category is
  // the reliable signal for "this is an obligation, not a subscription", so
  // both are used — the category catches the rent, the name catches a bucket
  // the user named after the merchant.
  const covered = new Set(
    workspace.buckets
      .filter((bucket) => bucket.kind === "reserve")
      .map((bucket) => merchantKey(bucket.name)),
  );

  return detectStreams(workspace, today, windowDays)
    .filter(
      (stream) =>
        stream.direction === "out" &&
        stream.cadence !== "irregular" &&
        // A subscription is the same price every time. Groceries recur weekly
        // but the amount moves, and that is what separates the two.
        stream.amountVariance <= 0.1 &&
        !OBLIGATION_CATEGORIES.has(stream.category) &&
        !covered.has(merchantKey(stream.merchant)),
    )
    .sort((a, b) => b.typicalAmount * perYear(b.cadence) - a.typicalAmount * perYear(a.cadence));
}

/** What a stream costs over a year. The figure that makes a subscription real. */
export const annualCost = (stream: Stream) => round2(stream.typicalAmount * perYear(stream.cadence));

/* ------------------------------------------------------------- spending -- */

export type CategoryTotal = {
  category: string;
  total: number;
  /** Share of all outflow in the window, 0–1. */
  share: number;
  transactions: number;
  /** Distinct merchants, most-spent first. Names the bucket for the user. */
  merchants: string[];
};

/**
 * Where the money actually went, by category.
 *
 * This is what decides how many buckets Steward proposes. The count comes from
 * the spending — a person whose outflow is three categories gets three buckets,
 * not a fixed number padded out to look thorough.
 */
export function spendingByCategory(
  workspace: Workspace,
  today: string,
  windowDays = 90,
): CategoryTotal[] {
  const cutoff = new Date(Date.parse(today) - windowDays * DAY).toISOString().slice(0, 10);

  const totals = new Map<string, { total: number; count: number; merchants: Map<string, number> }>();
  let overall = 0;

  for (const transaction of workspace.transactions) {
    if (transaction.type !== "expense") continue;
    if (transaction.excluded || transaction.pending) continue;
    if (transaction.date < cutoff || transaction.date > today) continue;

    // A split transaction belongs to several categories at once, and using its
    // top-level category would file the whole receipt under one of them.
    const parts = transaction.split?.length
      ? transaction.split
      : [{ category: transaction.category, amount: transaction.amount }];

    for (const part of parts) {
      const amount = Math.abs(part.amount);
      overall += amount;
      const entry = totals.get(part.category) ?? { total: 0, count: 0, merchants: new Map() };
      entry.total += amount;
      entry.count += 1;
      entry.merchants.set(
        transaction.merchant,
        (entry.merchants.get(transaction.merchant) ?? 0) + amount,
      );
      totals.set(part.category, entry);
    }
  }

  return [...totals.entries()]
    .map(([category, entry]) => ({
      category,
      total: round2(entry.total),
      share: overall > 0 ? round2(entry.total / overall) : 0,
      transactions: entry.count,
      merchants: [...entry.merchants.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([merchant]) => merchant),
    }))
    .sort((a, b) => b.total - a.total);
}
