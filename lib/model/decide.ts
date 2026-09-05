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
  formatDate,
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
import { currentLiquidity } from "./liquidity";
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
  const liquidity = currentLiquidity(workspace, today);
  const checks: VerdictCheck[] = [{ label: "Available today", status: liquidity.known && price <= liquidity.available ? "ok" : "warn", detail: liquidity.known ? `${formatMoney(liquidity.available)} after unpaid obligations, pending activity, earmarks and your buffer.` : "Balances are missing, stale or need attention. Refresh them before deciding to buy today." }];

  // 1 — obligations. These are never negotiable, so they are checked first.
  const nextBill = [...plan.reserves]
    .filter((entry) => entry.bucket.dueDate)
    .sort((a, b) => (a.bucket.dueDate! < b.bucket.dueDate! ? -1 : 1))[0];
  checks.push({
    label: "Bills and minimums",
    detail: nextBill
      ? `${formatMoney(plan.reservesTotal)} planned this cycle (not proof of payment). Next up: ${nextBill.bucket.name} on ${formatDate(nextBill.bucket.dueDate ?? null)}.`
      : `${formatMoney(plan.reservesTotal)} planned this cycle (not proof of payment).`,
    status: "ok",
  });

  // 2 — the everyday bucket this would come out of, if any.
  const bucket = input.bucketId
    ? workspace.buckets.find((entry) => entry.id === input.bucketId)
    : workspace.buckets.find(entry => entry.kind === "spend" && [entry.name, entry.category].some(name => name?.toLowerCase() === input.item.toLowerCase().replace(/^(some|a|an) /, "")));
  const remainingAllowance = bucket?.kind === "spend" ? Math.max(0, bucketActivity(workspace, bucket, cycle).remaining) : 0;
  const additionalSpend = round2(Math.max(0, price - remainingAllowance));
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
  const consequences = simulateSpend(reduced, today, additionalSpend, before, policy);

  const fitsInFreeCapacity = additionalSpend <= plan.freeCapacity + 0.01;
  const bucketOver = checks.some((check) => check.status === "warn" && check.label === bucket?.name);
  const delayed = consequences.filter((change) => change.direction === "later");

  let answer: Verdict["answer"];
  if (!Number.isFinite(price) || price <= 0 || !liquidity.known || price > liquidity.available || !fitsInFreeCapacity) answer = "wait";
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
          ? `Not verified for today. Projected saving date: ${formatDate(waitUntil)}.`
          : "Not this cycle.";

  const tradeoff = delayed.length
    ? delayed
        .slice(0, 2)
        .map((change) => `${change.name} moves to ${change.after ? formatDate(change.after) : "beyond a year"}`)
        .join(" · ")
    : answer === "wait"
      ? `${formatMoney(liquidity.available)} is verified for spending today; ${formatMoney(plan.freeCapacity)} is expected paycheck capacity. Future dates assume income arrives and bills are accurate.`
      : bucketOver
        ? `${formatMoney(additionalSpend)} would come from this paycheck's goal capacity because it exceeds ${bucket!.name}'s allowance. No projected goal dates move.`
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
  // Both scenarios traverse exactly the same calendar and obligation rollovers.
  // Keep first-cycle completions in the same projection instead of dropping
  // already-funded claims when starting a second projection next payday.
  if (price <= 0) return [];
  return diffArrivals(before, projectArrivals(workspace, today, policy, price));
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
  /** How far past pace, or how repeated. Higher shows first. */
  severity: number;
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
        // How far over pace, so 171% outranks 85%.
        severity: round2((fraction - expectedFraction) * 100),
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
        // Repetition matters less than blowing a bucket, so it scores lower.
        severity: round2(entry.rows.length),
        id: `repeat:${merchant}`,
        headline: `${merchant} × ${entry.rows.length} this cycle`,
        detail: `${formatMoney(entry.total)} across ${entry.rows.length} visits.`,
        evidence: entry.rows.slice(0, 4),
        tone: "neutral",
      });
    }
  }

  // Severity order, not bucket order.
  //
  // Iterating buckets and taking the first match meant a category at 85% could
  // outrank one at 171% purely because it sat earlier in the array. Since Now
  // shows exactly one insight, that surfaced the wrong problem and cost trust
  // the moment the user noticed.
  return insights.sort((a, b) => b.severity - a.severity).slice(0, 3);
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

/* ---------------------------------------------------------------- payday */

export type PaydayProposal = {
  sourceRevision?: number;
  cycleId: string;
  cycleEnd: string;
  income: number;
  reserves: { name: string; amount: number; note: string }[];
  reservesTotal: number;
  spend: { name: string; amount: number }[];
  spendTotal: number;
  bufferTopUp: number;
  freeCapacity: number;
  lines: { claim: Claim; amount: number; reason: string; arrival: string | null; completes: boolean }[];
  queued: { claim: Claim; arrival: string | null }[];
  /** True once the user has confirmed this cycle's plan. */
  confirmed: boolean;
};

/**
 * Build the payday plan for the current cycle.
 *
 * This only ever *describes* what Steward would do. Nothing here mutates
 * funding — see `confirmProposal`, which is the only path that does, and which
 * requires an explicit user action (BLUEPRINT.md §C10 / amendment A1).
 */
export function buildPaydayProposal(
  workspace: Workspace,
  today: string,
  policy: AllocationPolicy = defaultPolicy,
): PaydayProposal | null {
  const plan = planCycle(workspace, today);
  if (!plan) return null;
  const previous = new Map<string,number>();
  for(const a of workspace.allocations) if(a.cycleId===plan.cycle.id && a.status==='confirmed' && a.targetType==='claim') previous.set(a.targetId,(previous.get(a.targetId)??0)+a.amount);
  const basis={...workspace,claims:workspace.claims.map(c=>({...c,fundedAmount:round2(c.fundedAmount-(previous.get(c.id)??0))}))};
  const result = allocate(basis, plan.freeCapacity, today, policy);
  const arrivals = projectArrivals(workspace, today, policy);
  const arrivalFor = (id: string) => arrivals.find((entry) => entry.claimId === id)?.arrivalDate ?? null;

  return {
    sourceRevision: workspace.revision ?? 0,
    cycleId: plan.cycle.id,
    cycleEnd: plan.cycle.end,
    income: plan.income,
    reserves: plan.reserves.map((entry) => ({
      name: entry.bucket.name,
      amount: entry.required,
      note:
        entry.cyclesRemaining > 1
          ? `${formatMoney(entry.bucket.amountDue ?? 0)} due ${formatDate(entry.bucket.dueDate ?? null)}, split over ${entry.cyclesRemaining} paychecks`
          : `due ${entry.bucket.dueDate ? formatDate(entry.bucket.dueDate) : "this cycle"}`,
    })),
    reservesTotal: plan.reservesTotal,
    spend: plan.spend.map((entry) => ({ name: entry.bucket.name, amount: entry.amount })),
    spendTotal: plan.spendTotal,
    bufferTopUp: plan.bufferTopUp,
    freeCapacity: plan.freeCapacity,
    lines: result.allocations.map((entry) => ({
      claim: entry.claim,
      amount: entry.amount,
      reason: entry.reason,
      arrival: arrivalFor(entry.claim.id),
      completes: entry.completes,
    })),
    queued: result.queued.map((entry) => ({
      claim: entry.claim,
      arrival: arrivalFor(entry.claim.id),
    })),
    confirmed: isCycleConfirmed(workspace, plan.cycle.id),
  };
}

export function isCycleConfirmed(workspace: Workspace, cycleId: string) {
  return workspace.allocations.some(
    (row) => row.cycleId === cycleId && row.status === "confirmed",
  );
}

/**
 * Record the plan as confirmed. The ONLY path that moves discretionary money.
 *
 * Proposals for other cycles are dropped rather than merged: a plan the user
 * walked away from is superseded, never quietly applied later.
 */
export function confirmProposal(
  workspace: Workspace,
  proposal: PaydayProposal,
  now = new Date().toISOString(),
): Workspace {
  if (proposal.sourceRevision !== undefined && proposal.sourceRevision !== (workspace.revision ?? 0)) throw new Error("This plan changed. Review the updated proposal before confirming.");
  const ids = new Set<string>();
  for (const line of proposal.lines) {
    if (ids.has(line.claim.id) || !workspace.claims.some(c => c.id === line.claim.id) || !Number.isFinite(line.amount) || line.amount < 0) throw new Error("Invalid allocation target or amount.");
    ids.add(line.claim.id);
  }
  if (round2(proposal.lines.reduce((sum, line) => sum + line.amount, 0)) > proposal.freeCapacity + .01) throw new Error("Allocations exceed capacity.");
  const kept = workspace.allocations.filter(
    (row) => row.status === "confirmed" && row.cycleId !== proposal.cycleId,
  );
  // Money already recorded for this cycle is replaced, not stacked, so
  // confirming twice cannot double-fund.
  const alreadyThisCycle = new Map<string, number>();
  for (const row of workspace.allocations) {
    if (row.cycleId !== proposal.cycleId || row.status !== "confirmed") continue;
    alreadyThisCycle.set(row.targetId, (alreadyThisCycle.get(row.targetId) ?? 0) + row.amount);
  }
  const delta = new Map<string, number>([...alreadyThisCycle].map(([id, amount]) => [id, -amount]));
  for (const line of proposal.lines) {
    delta.set(
      line.claim.id,
      round2(line.amount - (alreadyThisCycle.get(line.claim.id) ?? 0)),
    );
  }

  return {
    ...workspace,
    claims: workspace.claims.map((claim) =>
      delta.has(claim.id)
        ? { ...claim, fundedAmount: round2(claim.fundedAmount + (delta.get(claim.id) ?? 0)) }
        : claim,
    ),
    allocations: [
      ...kept,
      ...proposal.lines.map((line, index) => ({
        id: `alloc:${proposal.cycleId}:${index}`,
        cycleId: proposal.cycleId,
        targetType: "claim" as const,
        targetId: line.claim.id,
        amount: line.amount,
        status: "confirmed" as const,
        createdAt: now,
      })),
    ],
  };
}

/** Discard any stored proposal that is not for the cycle in question. */
export function supersedeStaleProposals(workspace: Workspace, cycleId: string): Workspace {
  return {
    ...workspace,
    allocations: workspace.allocations.filter(
      (row) => row.status === "confirmed" || row.cycleId === cycleId,
    ),
  };
}

/* ------------------------------------------------------------------ debt */

export type PayoffScenario = {
  perCycle: number;
  arrivalDate: string | null;
  totalInterest: number;
  beyondHorizon: boolean;
};

export type DebtDetail = {
  claim: Claim;
  apr: number | null;
  balance: number;
  /** The required minimum, which lives above the line as an obligation. */
  minimum: number;
  current: PayoffScenario;
  /** Alternatives, so "what does an extra $50 buy me?" has a real answer. */
  options: PayoffScenario[];
};

/**
 * Payoff scenarios for one debt.
 *
 * Simulates the balance forward at a given per-cycle payment, accruing interest
 * on the stored APR. Returns nothing rather than guessing when the APR is
 * missing — a payoff date built on an invented rate is worse than no date.
 */
export function debtDetail(
  workspace: Workspace,
  claimId: string,
  today: string,
  policy: AllocationPolicy = defaultPolicy,
): DebtDetail | null {
  const claim = workspace.claims.find((entry) => entry.id === claimId);
  if (!claim || claim.kind !== "payoff") return null;

  const apr = claim.delayCost.type === "interest" ? claim.delayCost.apr : null;
  const minimumBucket = workspace.buckets.find(
    (bucket) => bucket.linkedDebtAccountId && bucket.linkedDebtAccountId === claim.linkedAccountId,
  );
  const minimum = minimumBucket?.amountDue ?? 0;

  const plan = planCycle(workspace, today);
  const allocated =
    plan
      ? allocate(workspace, plan.freeCapacity, today, policy).allocations.find(
          (entry) => entry.claim.id === claim.id,
        )?.amount ?? 0
      : 0;

  const balance = Math.max(0, round2(claim.targetAmount - claim.fundedAmount));
  const run = (perCycle: number) => simulatePayoff(workspace, balance, apr, perCycle, today, policy);

  const steps = [allocated, allocated + 50, allocated + 100, allocated + 200]
    .map((value) => round2(value))
    .filter((value, index, all) => value > 0 && all.indexOf(value) === index);

  return {
    claim,
    apr,
    balance,
    minimum,
    current: run(allocated),
    options: steps.slice(1).map(run),
  };
}

function simulatePayoff(
  workspace: Workspace,
  startBalance: number,
  apr: number | null,
  perCycle: number,
  today: string,
  policy: AllocationPolicy,
): PayoffScenario {
  if (apr === null || perCycle <= 0) {
    return { perCycle, arrivalDate: null, totalInterest: 0, beyondHorizon: true };
  }
  const cyclesPerYear =
    workspace.profile.payFrequency === "Weekly" ? 52 : workspace.profile.payFrequency === "Biweekly" ? 26 : 12;
  const horizon = Math.ceil((cyclesPerYear / 12) * policy.maxProjectionMonths);
  const paydays = upcomingPaydays(workspace, today, horizon);

  let balance = startBalance;
  let interest = 0;
  for (let step = 0; step < horizon; step += 1) {
    const accrued = round2(balance * (apr / 100 / cyclesPerYear));
    interest = round2(interest + accrued);
    balance = round2(balance + accrued - perCycle);
    if (balance <= 0.01) {
      return {
        perCycle,
        arrivalDate: paydays[step] ?? null,
        totalInterest: interest,
        beyondHorizon: false,
      };
    }
  }
  return { perCycle, arrivalDate: null, totalInterest: interest, beyondHorizon: true };
}

/* ---------------------------------------------------- category correction */

/**
 * Recategorize a transaction, and optionally remember it.
 *
 * Remembering writes a Rule and applies it to every other transaction from the
 * same merchant, so the correction is visibly worth making. The user sees every
 * affected number move at once, which is the point.
 */
export function recategorize(
  workspace: Workspace,
  transactionId: string,
  category: string,
  remember: boolean,
): Workspace {
  const target = workspace.transactions.find((row) => row.id === transactionId);
  if (!target) return workspace;
  const key = target.merchant.toLowerCase().replace(/[^a-z0-9]/g, "");

  return {
    ...workspace,
    rules: remember ? [...workspace.rules.filter(rule => rule.merchantKey !== key), { id: `rule:${key}`, merchantKey: key, category, createdAt: target.date }] : workspace.rules,
    transactions: workspace.transactions.map((row) => {
      const matches =
        row.id === transactionId ||
        (remember && row.merchant.toLowerCase().replace(/[^a-z0-9]/g, "") === key);
      return matches
        ? { ...row, category, categorySource: "manual" as const, needsReview: false, confidence: 1 }
        : row;
    }),
  };
}

/* ---------------------------------------------------------- acceleration */

export type CutOption = {
  bucketId: string;
  name: string;
  currentPerCycle: number;
  suggestedCut: number;
  /** Where the claim lands if this cut is made. */
  newArrival: string | null;
  cyclesSaved: number;
};

export type Acceleration = {
  claim: Claim;
  currentArrival: string | null;
  currentPerCycle: number;
  /** Extra per paycheck needed to land it one cycle sooner. */
  /** What it would take to finish this out of this paycheck. */
  neededPerCycle: number;
  /** Whether trimming everything discretionary would even cover it. */
  enoughAvailable: boolean;
  totalAvailable: number;
  soonestArrival: string | null;
  options: CutOption[];
};

/**
 * "Want it sooner? Here's what we'd cut."
 *
 * The negotiation half of the product. Steward never picks for the user — it
 * prices each option and lets them choose. Cuts are only ever offered from
 * discretionary spend buckets; obligations are not on the table, which is why
 * they are filtered out here rather than ranked lower.
 */
export function accelerate(
  workspace: Workspace,
  claimId: string,
  today: string,
  policy: AllocationPolicy = defaultPolicy,
): Acceleration | null {
  const claim = workspace.claims.find((entry) => entry.id === claimId);
  const plan = planCycle(workspace, today);
  if (!claim || !plan) return null;

  const before = projectArrivals(workspace, today, policy);
  const currentArrival = before.find((entry) => entry.claimId === claimId)?.arrivalDate ?? null;
  const allocatedNow =
    allocate(workspace, plan.freeCapacity, today, policy).allocations.find(
      (entry) => entry.claim.id === claimId,
    )?.amount ?? 0;
  const remaining = Math.max(0, round2(claim.targetAmount - claim.fundedAmount));

  // What it would take to finish this claim out of *this* paycheck.
  //
  // Pacing it "one cycle faster" is the wrong question for anything that
  // completes as soon as it is funded — a queued purchase doesn't arrive
  // sooner by receiving slightly more each cycle, it arrives sooner by being
  // funded now. So the number quoted is the real shortfall.
  const neededPerCycle = round2(Math.max(0, remaining - allocatedNow));

  const options: CutOption[] = [];
  for (const entry of plan.spend) {
    const bucket = entry.bucket;
    // Obligations and essentials are not on the table, by design.
    if (bucket.essential || entry.amount <= 0) continue;

    const cut = round2(Math.min(entry.amount, neededPerCycle || entry.amount));
    const trimmed: Workspace = {
      ...workspace,
      buckets: workspace.buckets.map((candidate) =>
        candidate.id === bucket.id
          ? { ...candidate, perCycle: round2((candidate.perCycle ?? 0) - cut) }
          : candidate,
      ),
    };
    const after = projectArrivals(trimmed, today, policy).find(
      (arrival) => arrival.claimId === claimId,
    );
    const newArrival = after?.arrivalDate ?? null;
    const saved =
      currentArrival && newArrival && newArrival < currentArrival
        ? Math.max(1, Math.round(daysBetween(newArrival, currentArrival) / 14))
        : 0;

    options.push({
      bucketId: bucket.id,
      name: bucket.name,
      currentPerCycle: entry.amount,
      suggestedCut: cut,
      newArrival,
      cyclesSaved: saved,
    });
  }

  // Everything discretionary, combined. Tells the user honestly when no single
  // cut is enough rather than offering three that each change nothing.
  const totalAvailable = round2(
    plan.spend
      .filter((entry) => !entry.bucket.essential)
      .reduce((sum, entry) => sum + entry.amount, 0),
  );

  return {
    claim,
    currentArrival,
    currentPerCycle: allocatedNow,
    neededPerCycle,
    enoughAvailable: totalAvailable >= neededPerCycle,
    totalAvailable,
    soonestArrival:
      options
        .map((option) => option.newArrival)
        .filter((date): date is string => Boolean(date))
        .sort()[0] ?? null,
    options: options.sort((a, b) => b.cyclesSaved - a.cyclesSaved || b.suggestedCut - a.suggestedCut).slice(0, 3),
  };
}

/**
 * The plan, as sentences.
 *
 * Every figure comes from the engine. The AI layer may reword these; it may not
 * produce them, and the guard in lib/model/ai.ts rejects any number it adds.
 */
export function planNarrative(workspace: Workspace, today: string, policy: AllocationPolicy = defaultPolicy) {
  const plan = planCycle(workspace, today);
  if (!plan) return null;
  const proposal = buildPaydayProposal(workspace,today,policy)!;
  const result = { allocations:proposal.lines, queued:proposal.queued };
  const arrivals = projectArrivals(workspace, today, policy);

  const lines = result.allocations.map((entry) => {
    const arrival = arrivals.find((item) => item.claimId === entry.claim.id);
    return {
      claimId: entry.claim.id,
      name: entry.claim.name,
      amount: entry.amount,
      arrival: arrival?.arrivalDate ?? null,
      completes: entry.completes,
      sentence: entry.completes
        ? `${formatMoney(entry.amount)} finishes ${entry.claim.name} in the plan; no purchase or transfer has been made.`
        : arrival?.arrivalDate
          ? `${formatMoney(entry.amount)} to ${entry.claim.name}, which lands ${formatDate(arrival.arrivalDate)}.`
          : `${formatMoney(entry.amount)} to ${entry.claim.name}.`,
    };
  });

  return {
    reserved: plan.reservesTotal,
    everyday: plan.spendTotal,
    free: plan.freeCapacity,
    lines,
    queued: result.queued.map((entry) => entry.claim.name),
    summary: `Your paycheck is ${formatMoney(plan.income)}. ${formatMoney(plan.reservesTotal)} is planned for bills and minimums, ${formatMoney(plan.spendTotal)} is everyday spending, which leaves ${formatMoney(plan.freeCapacity)}.`,
  };
}


/* ------------------------------------------------------------------ split */

export type SplitLine = { category: string; amount: number };

/**
 * A split is valid only if it reconciles to what the bank actually charged.
 *
 * The transaction total is truth; a receipt or a manual split only explains its
 * composition. This is what lets Steward accept extracted line items without
 * trusting them — arithmetic decides, not the source.
 */
export function splitIsBalanced(total: number, lines: SplitLine[]) {
  const sum = lines.reduce((running, line) => running + line.amount, 0);
  return Math.abs(round2(sum) - round2(total)) < 0.01;
}

export function splitDifference(total: number, lines: SplitLine[]) {
  return round2(total - lines.reduce((running, line) => running + line.amount, 0));
}

/**
 * Apply a split. Refuses anything that does not reconcile, rather than filing
 * numbers that quietly do not add up.
 */
export function splitTransaction(
  workspace: Workspace,
  transactionId: string,
  lines: SplitLine[],
): Workspace {
  const target = workspace.transactions.find((row) => row.id === transactionId);
  if (!target) return workspace;
  const clean = lines.filter((line) => line.category && line.amount > 0);
  if (!clean.length || !splitIsBalanced(target.amount, clean)) return workspace;

  return {
    ...workspace,
    transactions: workspace.transactions.map((row) =>
      row.id === transactionId
        ? {
            ...row,
            split: clean,
            // The headline category becomes the largest line, so the row still
            // reads sensibly in a list that shows one label.
            category: [...clean].sort((a, b) => b.amount - a.amount)[0].category,
            categorySource: "manual" as const,
            needsReview: false,
          }
        : row,
    ),
  };
}

/** Remove a split and return the transaction to a single category. */
export function unsplitTransaction(workspace: Workspace, transactionId: string): Workspace {
  return {
    ...workspace,
    transactions: workspace.transactions.map((row) =>
      row.id === transactionId ? { ...row, split: undefined } : row,
    ),
  };
}

/* --------------------------------------------------------------- promote */

export type Promotion = {
  workspace: Workspace;
  /** Where the promoted claim now lands. */
  arrival: string | null;
  /** What moved to make room, so the cost is never hidden. */
  changes: DateChange[];
};

/**
 * Move a claim to the top of the list and report what it costs.
 *
 * Steward was already telling users this was the faster route and then leaving
 * them to go and do it — advice that makes you do the work. Reordering is
 * future-cycle only, so nothing already funded moves; only what happens next
 * changes, and every date that shifts is named.
 */
export function promoteClaim(
  workspace: Workspace,
  claimId: string,
  today: string,
  policy: AllocationPolicy = defaultPolicy,
): Promotion | null {
  const claim = workspace.claims.find((entry) => entry.id === claimId);
  if (!claim) return null;

  const before = projectArrivals(workspace, today, policy);
  const promoted: Workspace = {
    ...workspace,
    claims: workspace.claims.map((entry) =>
      entry.id === claimId
        ? { ...entry, rank: -1, status: "active" as const }
        : { ...entry, rank: entry.rank + 1 },
    ),
  };
  // Re-index so ranks stay contiguous from zero.
  const ordered = [...promoted.claims].sort((a, b) => a.rank - b.rank);
  const normalized: Workspace = {
    ...promoted,
    claims: promoted.claims.map((entry) => ({
      ...entry,
      rank: ordered.findIndex((candidate) => candidate.id === entry.id),
    })),
  };

  const after = projectArrivals(normalized, today, policy);
  return {
    workspace: normalized,
    arrival: after.find((entry) => entry.claimId === claimId)?.arrivalDate ?? null,
    changes: diffArrivals(before, after).filter((change) => change.claimId !== claimId),
  };
}
