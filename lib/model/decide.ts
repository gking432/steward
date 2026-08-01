/**
 * DECISION LAYER — "Can I buy this?" and the daily insight.
 *
 * Deterministic. The verdict, every check behind it, and every date it quotes
 * are computed here. A language model may only rephrase the result (§K); it
 * never decides, and it never sees a number that did not come from this file.
 *
 * Three verdicts, never a bare "no": there is always a *when*, and the when is
 * the answer (BLUEPRINT.md §I).
 */

import {
  allocate,
  diffArrivals,
  formatMoney,
  planCycle,
  projectArrivals,
  bucketActivity,
  currentCycle,
  daysBetween,
  steadyFreeCapacity,
  upcomingPaydays,
  type Arrival,
  type DateChange,
} from "./engine";
import { defaultPolicy, type AllocationPolicy } from "./policy";
import type { Claim, Workspace } from "./types";

export type CheckStatus = "ok" | "warn";

export type VerdictCheck = {
  label: string;
  detail: string;
  status: CheckStatus;
};

export type Verdict = {
  answer: "yes" | "yes-but" | "wait";
  headline: string;
  price: number;
  item: string;
  checks: VerdictCheck[];
  /** Claims whose arrival date moves if this is bought now. */
  consequences: DateChange[];
  /** The soonest cycle end at which this fits without disturbing anything. */
  waitUntil: string | null;
  /** Per-cycle amount if the user saves for it instead. */
  saveRate: number | null;
  tradeoff: string;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Evaluate a purchase against the whole picture.
 *
 * The order of checks is the order of the waterfall, so the reasoning the user
 * reads is the same reasoning the engine performed.
 */
export function evaluatePurchase(
  workspace: Workspace,
  today: string,
  input: { item: string; price: number; bucketId?: string; projectId?: string },
  policy: AllocationPolicy = defaultPolicy,
): Verdict | null {
  const plan = planCycle(workspace, today);
  const cycle = currentCycle(workspace, today);
  if (!plan || !cycle) return null;

  const price = round2(input.price);
  const checks: VerdictCheck[] = [];

  // 1 — obligations. These are never negotiable, so they are checked first.
  const nextBill = [...plan.reserves]
    .filter((entry) => entry.bucket.dueDate)
    .sort((a, b) => (a.bucket.dueDate! < b.bucket.dueDate! ? -1 : 1))[0];
  checks.push({
    label: "Bills and minimums",
    detail: nextBill
      ? `${formatMoney(plan.reservesTotal)} reserved this cycle. Next up: ${nextBill.bucket.name} on ${nextBill.bucket.dueDate}.`
      : `${formatMoney(plan.reservesTotal)} reserved this cycle.`,
    status: "ok",
  });

  // 2 — the everyday bucket this would come out of, if any.
  const bucket = input.bucketId
    ? workspace.buckets.find((entry) => entry.id === input.bucketId)
    : undefined;
  if (bucket) {
    const activity = bucketActivity(workspace, bucket, cycle);
    const after = round2(activity.remaining - price);
    checks.push({
      label: bucket.name,
      detail:
        after >= 0
          ? `${formatMoney(activity.remaining)} left, ${formatMoney(after)} after this.`
          : `${formatMoney(activity.remaining)} left — this would put it ${formatMoney(-after)} over.`,
      status: after >= 0 ? "ok" : "warn",
    });
  }

  // 3 — the protected buffer is never spent to fund a want.
  checks.push({
    label: "Cash buffer",
    detail:
      plan.bufferTopUp > 0
        ? `Still ${formatMoney(plan.bufferTopUp)} short of your ${formatMoney(workspace.profile.bufferFloor)} floor.`
        : `Your ${formatMoney(workspace.profile.bufferFloor)} floor stays untouched.`,
    status: plan.bufferTopUp > 0 ? "warn" : "ok",
  });

  // 4 — what this costs the things already in flight.
  const before = projectArrivals(workspace, today, policy);
  const reduced: Workspace = {
    ...workspace,
    profile: { ...workspace.profile },
  };
  const consequences = simulateSpend(reduced, today, price, before, policy);

  const fitsInFreeCapacity = price <= plan.freeCapacity + 0.01;
  const bucketOver = checks.some((check) => check.status === "warn" && check.label === bucket?.name);
  const delayed = consequences.filter((change) => change.direction === "later");

  let answer: Verdict["answer"];
  if (!fitsInFreeCapacity || plan.freeCapacity <= 0) answer = "wait";
  else if (bucketOver || delayed.length > 0) answer = "yes-but";
  else answer = "yes";

  const waitUntil = answer === "wait" ? soonestAffordable(workspace, today, price) : null;
  const saveRate = answer === "wait" ? soonestSaveRate(workspace, today, price) : null;

  const headline =
    answer === "yes"
      ? "Yes."
      : answer === "yes-but"
        ? "Yes — with one tradeoff."
        : waitUntil
          ? `Wait until ${waitUntil}.`
          : "Not this cycle.";

  const tradeoff = delayed.length
    ? delayed
        .slice(0, 2)
        .map((change) => `${change.name} moves to ${change.after ?? "beyond a year"}`)
        .join(" · ")
    : answer === "wait"
      ? `${formatMoney(price)} is more than the ${formatMoney(plan.freeCapacity)} free this cycle.`
      : "Nothing you're working toward moves.";

  return {
    answer,
    headline,
    price,
    item: input.item,
    checks,
    consequences: delayed,
    waitUntil,
    saveRate,
    tradeoff,
  };
}

/**
 * Spending money now means less free capacity this cycle. Model that by
 * reducing what the allocator has to work with, then re-projecting.
 */
function simulateSpend(
  workspace: Workspace,
  today: string,
  price: number,
  before: Arrival[],
  policy: AllocationPolicy,
): DateChange[] {
  const plan = planCycle(workspace, today);
  if (!plan) return [];
  const reducedCapacity = Math.max(0, round2(plan.freeCapacity - price));

  // Apply one cycle at the reduced capacity, then project normally from there.
  const result = allocate(workspace, reducedCapacity, today, policy);
  const advanced: Workspace = {
    ...workspace,
    claims: workspace.claims.map((claim) => ({
      ...claim,
      fundedAmount: round2(
        claim.fundedAmount +
          (result.allocations.find((entry) => entry.claim.id === claim.id)?.amount ?? 0),
      ),
    })),
  };
  const nextToday = upcomingPaydays(workspace, today, 1)[0] ?? today;
  const after = projectArrivals(advanced, nextToday, policy);
  return diffArrivals(before, after);
}

/**
 * The first upcoming payday at which the price fits.
 *
 * Uses steady-state capacity rather than re-planning each future cycle: the
 * current plan starts from a zero reserve balance, so re-deriving it for a
 * future date would re-charge every obligation in full and report that nothing
 * is ever affordable.
 */
function soonestAffordable(
  workspace: Workspace,
  today: string,
  price: number,
): string | null {
  const steady = steadyFreeCapacity(workspace);
  if (steady <= 0) return null;
  const cycles = Math.max(1, Math.ceil(price / steady));
  const paydays = upcomingPaydays(workspace, today, Math.min(cycles, 26));
  return paydays[Math.min(cycles, paydays.length) - 1] ?? null;
}

/** What saving for it costs per paycheck, at a pace that reaches it sensibly. */
function soonestSaveRate(workspace: Workspace, today: string, price: number) {
  const steady = steadyFreeCapacity(workspace);
  if (steady <= 0) return null;
  // Take at most half of steady capacity so one want cannot monopolise a cycle.
  const cycles = Math.max(1, Math.ceil(price / Math.max(1, steady / 2)));
  return round2(price / cycles);
}

/**
 * Turn a "wait" verdict into a Claim without a form. This is the primary way
 * claims enter the system (BLUEPRINT.md §B5 / §I).
 */
export function claimFromPurchase(input: {
  item: string;
  price: number;
  projectId?: string;
  wantBy?: string;
  rank: number;
}): Claim {
  return {
    id: `claim:${input.item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`,
    name: input.item,
    kind: "purchase",
    projectId: input.projectId,
    targetAmount: input.price,
    fundedAmount: 0,
    rank: input.rank,
    status: "active",
    horizon: "arrival",
    divisible: false,
    delayCost: input.wantBy ? { type: "deadline", date: input.wantBy } : { type: "none" },
    protected: false,
    wantBy: input.wantBy,
  };
}

/* --------------------------------------------------------------- insights */

export type Insight = {
  id: string;
  headline: string;
  detail: string;
  /** Transactions proving the claim. An insight with no evidence is not shown. */
  evidence: string[];
  tone: "neutral" | "watch";
};

/**
 * At most one insight per day, and only when it can point at transactions.
 * Everything here is arithmetic — no model is involved in deciding what is
 * true, only (later, optionally) in how it is worded.
 */
export function dailyInsights(workspace: Workspace, today: string): Insight[] {
  const cycle = currentCycle(workspace, today);
  if (!cycle) return [];
  const insights: Insight[] = [];

  // Pace: a bucket burning faster than the days remaining justify.
  const elapsed = Math.max(1, daysBetween(cycle.start, today));
  const total = Math.max(1, daysBetween(cycle.start, cycle.end));
  const expectedFraction = elapsed / total;
  for (const bucket of workspace.buckets.filter((entry) => entry.kind === "spend")) {
    const activity = bucketActivity(workspace, bucket, cycle);
    if (activity.planned <= 0 || activity.rows.length === 0) continue;
    const fraction = activity.spent / activity.planned;
    if (fraction > expectedFraction + 0.25) {
      const projected = round2(activity.spent / Math.max(0.01, expectedFraction));
      insights.push({
        id: `pace:${bucket.id}`,
        headline: `${bucket.name} is running hot`,
        detail: `${formatMoney(activity.spent)} of ${formatMoney(activity.planned)} with ${daysBetween(today, cycle.end)} days left. At this pace you'd finish around ${formatMoney(projected)}.`,
        evidence: activity.rows.slice(0, 4).map(
          (row) => `${row.merchant} · ${row.date} · ${formatMoney(row.amount)}`,
        ),
        tone: "watch",
      });
    }
  }

  // Repetition: the same merchant, several times, adding up.
  const counts = new Map<string, { total: number; rows: string[] }>();
  for (const row of workspace.transactions.filter(
    (entry) => entry.type === "expense" && entry.date >= cycle.start,
  )) {
    const entry = counts.get(row.merchant) ?? { total: 0, rows: [] };
    entry.total = round2(entry.total + row.amount);
    entry.rows.push(`${row.date} · ${formatMoney(row.amount)}`);
    counts.set(row.merchant, entry);
  }
  for (const [merchant, entry] of counts) {
    if (entry.rows.length >= 3) {
      insights.push({
        id: `repeat:${merchant}`,
        headline: `${merchant} × ${entry.rows.length} this cycle`,
        detail: `${formatMoney(entry.total)} across ${entry.rows.length} visits.`,
        evidence: entry.rows.slice(0, 4),
        tone: "neutral",
      });
    }
  }

  return insights.slice(0, 3);
}

/** Progress since the start of this cycle, for the Now screen. */
export function progressSummary(workspace: Workspace, today: string) {
  const arrivals = projectArrivals(workspace, today);
  return workspace.claims
    .filter((claim) => claim.status === "active" && claim.fundedAmount > 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 4)
    .map((claim) => {
      const arrival = arrivals.find((entry) => entry.claimId === claim.id);
      return {
        claim,
        percent: claim.targetAmount > 0 ? (claim.fundedAmount / claim.targetAmount) * 100 : 0,
        arrivalDate: arrival?.arrivalDate ?? null,
        beyondHorizon: arrival?.beyondHorizon ?? true,
      };
    });
}
