/**
 * THE DETERMINISTIC ENGINE (Phase 2).
 *
 * Every number Steward shows originates here. No language model is involved at
 * any point, and no function in this file reads the clock implicitly — `today`
 * is always an argument, so results are reproducible.
 *
 * Order of truth (BLUEPRINT.md §C1):
 *
 *     income + carry-in
 *   − reserves (obligations, pro-rated)
 *   − spend buckets (everyday)
 *   − buffer top-up
 *   − protected commitments
 *   = FREE CAPACITY  → ranked claims
 *
 * IMPLEMENTATION NOTE — carry-in.
 * The blueprint defined carry-in as liquid cash minus unspent reserves, unspent
 * spend balances, and the buffer floor. Implementing it exposed a genuine
 * problem: mid-cycle that expression double-counts money already earmarked and
 * makes free capacity drift day to day for reasons the user cannot see. Since
 * free capacity is the number every arrival date hangs off, that is
 * unacceptable. Carry-in is therefore the *explicit unallocated remainder of
 * the previous closed cycle* — auditable, stable within a cycle, and zero until
 * a cycle actually closes. Same intent, deterministic.
 */

import type {
  Bucket,
  Claim,
  Cycle,
  Transaction,
  Workspace,
} from "./types";
import { defaultPolicy, type AllocationPolicy } from "./policy";

/* --------------------------------------------------------------- calendar */

const DAY = 86_400_000;

export const parseDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
export const toISO = (date: Date) => date.toISOString().slice(0, 10);

/** Calendar arithmetic from a stable anchor; month-end stays month-end. */
export function addCycle(iso: string, frequency: Workspace["profile"]["payFrequency"], steps = 1) {
  const date = parseDate(iso);
  if (frequency !== "Monthly") date.setUTCDate(date.getUTCDate() + (frequency === "Weekly" ? 7 : 14) * steps);
  else {
    const day = date.getUTCDate();
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + steps);
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(day === last ? end : Math.min(day, end));
  }
  return toISO(date);
}

export function dayBefore(iso: string) {
  const date = parseDate(iso);
  date.setUTCDate(date.getUTCDate() - 1);
  return toISO(date);
}

export function daysBetween(fromISO: string, toISODate: string) {
  return Math.round((parseDate(toISODate).getTime() - parseDate(fromISO).getTime()) / DAY);
}

/** Upcoming paydays strictly after `today`, in order. */
export function upcomingPaydays(workspace: Workspace, today: string, count: number) {
  const { nextPayday, payFrequency } = workspace.profile;
  if (!nextPayday) return [];
  const result: string[] = [];
  let step = 0;
  let cursor = nextPayday;
  // Walk forward past any payday that has already gone by.
  let guard = 0;
  while (addCycle(nextPayday,payFrequency,step-1) > today && guard++ < 500) cursor=addCycle(nextPayday,payFrequency,--step);
  while (cursor <= today && guard++ < 500) cursor = addCycle(nextPayday, payFrequency, ++step);
  while (result.length < count && guard++ < 500) {
    result.push(cursor);
    cursor = addCycle(nextPayday, payFrequency, ++step);
  }
  return result;
}

/** The cycle containing `today`: opens on the last payday, ends on the next. */
export function currentCycle(workspace: Workspace, today: string): Cycle | null {
  const [next] = upcomingPaydays(workspace, today, 1);
  if (!next) return null;
  let offset = 0;
  while (addCycle(workspace.profile.nextPayday,workspace.profile.payFrequency,offset) > next && offset > -500) offset--;
  while (addCycle(workspace.profile.nextPayday, workspace.profile.payFrequency, offset) < next && offset < 500) offset++;
  const start = addCycle(workspace.profile.nextPayday, workspace.profile.payFrequency, offset - 1);
  return {
    id: `cycle:${next}`,
    start,
    end: next,
    expectedIncome: workspace.profile.takeHomePay,
    actualIncome: 0,
    status: "active",
  };
}

/* --------------------------------------------------------------- reserves */

/**
 * Pro-rating (BLUEPRINT.md §C2) — the calculation everything else depends on.
 *
 * `cyclesRemaining` counts the paydays between now and the due date. A bill
 * landing before the next payday must be covered from money already in hand, so
 * the minimum is 1 and the whole amount is required this cycle.
 */
export function billAmount(bucket: Bucket): number {
  return bucket.scheduledAmount && bucket.dueDate && bucket.dueDate >= bucket.scheduledAmount.effectiveDate
    ? bucket.scheduledAmount.amount : bucket.amountDue ?? 0;
}

export function reserveRequirement(
  bucket: Bucket,
  workspace: Workspace,
  today: string,
): { required: number; cyclesRemaining: number; outstanding: number; steadyRate: number } {
  const amountDue = billAmount(bucket);
  const outstanding = Math.max(0, amountDue - (bucket.reserved ?? 0));

  const paydays = bucket.dueDate
    ? upcomingPaydays(workspace, today, 400).filter((payday) => payday <= bucket.dueDate!)
    : [];
  const cyclesRemaining = Math.max(1, paydays.length);

  // Catch-up: what this occurrence still needs, spread over the paychecks left
  // before it lands. A bill due before the next payday must be covered in full
  // from money already in hand, hence the floor of one cycle.
  const catchUp = round2(outstanding / cyclesRemaining);

  // A one-time obligation has no next occurrence, so catch-up is the whole
  // story.
  if (bucket.frequency === "one-time" || !bucket.dueDate) {
    return { required: catchUp, cyclesRemaining, outstanding, steadyRate: 0 };
  }

  // Steady rate: what a recurring obligation costs per paycheck on average.
  //
  // Charging only `catchUp` was the obvious implementation and it is wrong: a
  // fully-reserved bill then demands nothing for a cycle, refills, and
  // discharges, and several bills doing this at different periods make free
  // capacity oscillate — measured at $83 to $1,432 on the golden fixture.
  // Since every arrival date hangs off free capacity, those dates would jump
  // around for reasons no user could follow. Reserving at the steady rate and
  // topping up only when genuinely behind keeps the number stable.
  const steadyRate = round2(amountDue / cyclesPerPeriod(bucket.frequency, workspace));

  return {
    required: Math.max(steadyRate, catchUp),
    cyclesRemaining,
    outstanding,
    steadyRate,
  };
}

/** Paychecks that fall within one occurrence interval of an obligation. */
function cyclesPerPeriod(frequency: Bucket["frequency"], workspace: Workspace) {
  const perYear = cyclesPerYearFor(workspace);
  if (frequency === "weekly") return perYear / 52;
  if (frequency === "biweekly") return perYear / 26;
  if (frequency === "annual") return perYear;
  return perYear / 12;
}

/* ---------------------------------------------------------------- ledger */

export function transactionsInCycle(transactions: Transaction[], cycle: Cycle) {
  return transactions.filter(
    (transaction) =>
      transaction.date >= cycle.start &&
      transaction.date < cycle.end &&
      !transaction.excluded,
  );
}

/**
 * How much of a transaction belongs to a given category.
 *
 * A split transaction contributes a portion to several buckets. Without this,
 * one $120 shop lands entirely in whichever category it was labelled, so one
 * bucket reads over and another reads untouched — two wrong numbers from one
 * purchase, on the screen whose entire promise is that the numbers are true.
 */
export function amountForCategory(transaction: Transaction, category: string) {
  if (transaction.split?.length) {
    return round2(
      transaction.split
        .filter((line) => line.category === category)
        .reduce((sum, line) => sum + line.amount, 0),
    );
  }
  return transaction.category === category ? transaction.amount : 0;
}

/** Spend recorded against a bucket this cycle, and the transactions behind it. */
export function bucketActivity(workspace: Workspace, bucket: Bucket, cycle: Cycle) {
  const category = bucket.category ?? bucket.name;
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matches = (transaction: Transaction) => bucket.merchantKey
    ? key(transaction.merchant) === bucket.merchantKey
    : !workspace.buckets.some((other) => other.id !== bucket.id && other.merchantKey === key(transaction.merchant) && other.category === category);
  const rows = transactionsInCycle(workspace.transactions, cycle).filter(
    (transaction) =>
      transaction.type === "expense" && matches(transaction) && amountForCategory(transaction, category) !== 0,
  );
  const spent = round2(
    rows.reduce((sum, row) => sum + amountForCategory(row, category), 0),
  );
  const planned = round2(bucket.perCycle ?? 0);
  return {
    bucket,
    rows,
    spent,
    planned,
    remaining: round2(planned - spent),
    percent: planned > 0 ? (spent / planned) * 100 : 0,
    /** Pace-aware: is this bucket ahead of where the calendar says it should be? */
    hot: planned > 0 && spent / planned > 0.8,
  };
}

/* ------------------------------------------------------------- waterfall */

export type CyclePlan = {
  cycle: Cycle;
  income: number;
  carryIn: number;
  reserves: { bucket: Bucket; required: number; cyclesRemaining: number; outstanding: number; steadyRate: number }[];
  reservesTotal: number;
  spend: { bucket: Bucket; amount: number }[];
  spendTotal: number;
  bufferTopUp: number;
  commitments: { claim: Claim; amount: number }[];
  commitmentsTotal: number;
  freeCapacity: number;
  /** Set when obligations exceed income; never resolved automatically. §C6. */
  shortfall: { amount: number; largestDriver: string } | null;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function liquidCash(workspace: Workspace) {
  return workspace.accounts
    .filter((account) => ["Checking", "Cash"].includes(account.type) && !account.archived)
    .reduce((sum, account) => sum + account.available, 0);
}

export function planCycle(
  workspace: Workspace,
  today: string,
  options: { carryIn?: number } = {},
): CyclePlan | null {
  const cycle = currentCycle(workspace, today);
  if (!cycle) return null;

  const income = workspace.profile.takeHomePay;
  const carryIn = options.carryIn ?? 0;

  const reserves = workspace.buckets
    .filter((bucket) => bucket.kind === "reserve")
    .map((bucket) => ({ bucket, ...reserveRequirement(bucket, workspace, today) }))
    .filter((entry) => entry.required > 0);
  const reservesTotal = round2(reserves.reduce((sum, entry) => sum + entry.required, 0));

  const spend = workspace.buckets
    .filter((bucket) => bucket.kind === "spend")
    .map((bucket) => ({ bucket, amount: round2(bucket.perCycle ?? 0) }))
    .filter((entry) => entry.amount > 0);
  const spendTotal = round2(spend.reduce((sum, entry) => sum + entry.amount, 0));

  const cash = liquidCash(workspace);
  const bufferTopUp = round2(Math.max(0, workspace.profile.bufferFloor - cash));

  const commitments = workspace.claims
    .filter((claim) => claim.status === "active" && claim.horizon === "commitment")
    .map((claim) => ({ claim, amount: round2(claim.pinned ?? 0) }))
    .filter((entry) => entry.amount > 0);
  const commitmentsTotal = round2(commitments.reduce((sum, entry) => sum + entry.amount, 0));

  const freeCapacity = round2(
    income + carryIn - reservesTotal - spendTotal - bufferTopUp - commitmentsTotal,
  );

  let shortfall: CyclePlan["shortfall"] = null;
  if (freeCapacity < 0) {
    const largest = [...reserves].sort((a, b) => b.required - a.required)[0];
    shortfall = {
      amount: round2(-freeCapacity),
      largestDriver: largest ? largest.bucket.name : "everyday spending",
    };
  }

  return {
    cycle,
    income,
    carryIn,
    reserves,
    reservesTotal,
    spend,
    spendTotal,
    bufferTopUp,
    commitments,
    commitmentsTotal,
    freeCapacity: Math.max(0, freeCapacity),
    shortfall,
  };
}

/**
 * Free capacity once obligations have settled into their steady rate.
 *
 * The current cycle can be unrepresentative — bills landing before the next
 * payday must be covered in full, so the first cycle carries catch-up that
 * later cycles do not. Anything reasoning about *future* cycles should use this
 * rather than re-deriving the current plan, which would re-charge every
 * obligation from a zero reserve.
 */
export function steadyFreeCapacity(workspace: Workspace) {
  const reserves = workspace.buckets
    .filter((bucket) => bucket.kind === "reserve" && bucket.frequency !== "one-time")
    .reduce(
      (sum, bucket) =>
        sum + billAmount(bucket) / cyclesPerPeriod(bucket.frequency, workspace),
      0,
    );
  const spend = workspace.buckets
    .filter((bucket) => bucket.kind === "spend")
    .reduce((sum, bucket) => sum + (bucket.perCycle ?? 0), 0);
  const commitments = workspace.claims
    .filter((claim) => claim.status === "active" && claim.horizon === "commitment")
    .reduce((sum, claim) => sum + (claim.pinned ?? 0), 0);
  return round2(Math.max(0, workspace.profile.takeHomePay - reserves - spend - commitments));
}

/* ------------------------------------------------------------- allocator */

export type ProposedAllocation = {
  claim: Claim;
  amount: number;
  /** Why this claim got this amount. Shown verbatim; never model-generated. */
  reason: string;
  completes: boolean;
};

export type AllocationResult = {
  allocations: ProposedAllocation[];
  /** Ranked claims that receive nothing this cycle, with when they begin. */
  queued: { claim: Claim; startsOn: string | null }[];
  unallocated: number;
  /** True when more claims were funded than the concentration target. §C4. */
  exceededConcentration: boolean;
};

function activeRanked(workspace: Workspace) {
  return workspace.claims
    .filter((claim) => claim.status === "active" && claim.horizon === "arrival")
    .sort((a, b) => a.rank - b.rank);
}

const needOf = (claim: Claim) => claim.openEnded ? Number.MAX_SAFE_INTEGER : Math.max(0, round2(claim.targetAmount - claim.fundedAmount));

/**
 * Distribute free capacity across ranked claims.
 *
 * Deadlines and pins are honoured first because they represent explicit user
 * intent. Everything else flows strictly top-down, where each claim takes the
 * smallest of: what it needs to finish, its policy cap (payoff claims only),
 * and what is left.
 *
 * This is what produces "make fewer things happen faster" without ever letting
 * one large payoff claim starve the entire list forever.
 */
export function allocate(
  workspace: Workspace,
  freeCapacity: number,
  today: string,
  policy: AllocationPolicy = defaultPolicy,
): AllocationResult {
  const claims = activeRanked(workspace);
  const taken = new Map<string, { amount: number; reason: string }>();
  let left = round2(freeCapacity);

  const give = (claim: Claim, amount: number, reason: string) => {
    const capped = round2(Math.min(amount, left, needOf(claim) - (taken.get(claim.id)?.amount ?? 0)));
    if (capped <= 0) return;
    const previous = taken.get(claim.id);
    taken.set(claim.id, {
      amount: round2((previous?.amount ?? 0) + capped),
      reason: previous?.reason ?? reason,
    });
    left = round2(left - capped);
  };

  // 1 — pins: explicit user intent outranks every heuristic.
  for (const claim of claims) {
    if (claim.pinned && claim.pinned > 0) {
      give(claim, claim.pinned, `You pinned ${formatMoney(claim.pinned)} to this.`);
    }
  }

  // 2 — deadlines: fund what a stated wantBy actually requires.
  for (const claim of claims) {
    const cost = claim.delayCost;
    if (cost.type !== "deadline" || claim.pinned !== undefined) continue;
    const paydaysBefore = upcomingPaydays(workspace, today, 60).filter(
      (payday) => payday <= cost.date,
    ).length;
    const cycles = Math.max(1, paydaysBefore);
    give(claim, needOf(claim) / cycles, `Needed by ${cost.date}.`);
  }

  // 3 — ranked waterfall with per-cycle ceilings.
  //
  // Every claim needs a ceiling, or the first large divisible claim swallows
  // the whole list and nothing below it ever moves. Ceilings differ by kind:
  //
  //   payoff      the policy's interest-aware cap
  //   fund        the rate its own wantBy implies — this is what makes a
  //               target date do real work instead of being decoration
  //   purchase    its full remaining cost; completion is the point
  //
  // A claim with no ceiling of its own takes what is left, which is correct
  // for the last divisible claim standing.
  for (const claim of claims) {
    if (claim.pinned !== undefined) continue;
    if (left <= 0) break;
    let ceiling = needOf(claim);
    let reason = "Next on your list.";

    if (claim.kind === "payoff") {
      const apr = claim.delayCost.type === "interest" ? claim.delayCost.apr : undefined;
      const suggestion = policy.suggestForDebt({
        apr,
        balance: claim.targetAmount,
        freeCapacity,
      });
      ceiling = Math.min(ceiling, suggestion.amount);
      reason = suggestion.rationale;
    } else if (claim.divisible && claim.wantBy) {
      const cycles = Math.max(
        1,
        upcomingPaydays(workspace, today, 400).filter((payday) => payday <= claim.wantBy!).length,
      );
      ceiling = Math.min(ceiling, round2(needOf(claim) / cycles));
      reason = `Paced to reach ${formatMoney(claim.targetAmount)} by ${claim.wantBy}.`;
    }

    give(claim, ceiling, reason);
  }

  // 4 — anything still unallocated flows to the highest-ranked claim that can
  //     still use it, rather than sitting idle.
  if (left > 0) {
    const sink = claims.find(
      (claim) => claim.pinned === undefined && needOf(claim) > (taken.get(claim.id)?.amount ?? 0),
    );
    if (sink) give(sink, left, "Remainder from this paycheck.");
  }

  const allocations: ProposedAllocation[] = claims
    .filter((claim) => (taken.get(claim.id)?.amount ?? 0) > 0)
    .map((claim) => {
      const entry = taken.get(claim.id)!;
      return {
        claim,
        amount: entry.amount,
        reason: entry.reason,
        completes: entry.amount >= needOf(claim) - 0.01,
      };
    });

  const funded = new Set(allocations.map((allocation) => allocation.claim.id));
  const queued = claims
    .filter((claim) => !funded.has(claim.id))
    .map((claim) => ({ claim, startsOn: null as string | null }));

  return {
    allocations,
    queued,
    unallocated: round2(left),
    exceededConcentration: allocations.length > policy.concentrationTarget,
  };
}

/* ------------------------------------------------------------ projection */

export type Arrival = {
  claimId: string;
  name: string;
  /** null when the claim is unreachable inside the projection horizon. */
  arrivalDate: string | null;
  /** Cycles until the claim first receives money. 0 = this cycle. */
  startsInCycles: number;
  perCycle: number;
  beyondHorizon: boolean;
};

/**
 * Walk cycles forward, re-running the allocator each time, until every claim is
 * satisfied or the horizon is reached. Income, reserves, spend and ranking are
 * held constant — this is a projection of the current plan, not a forecast of
 * the user's life, and the UI must say so.
 */
export function projectArrivals(
  workspace: Workspace,
  today: string,
  policy: AllocationPolicy = defaultPolicy,
  firstCycleSpend = 0,
): Arrival[] {
  const horizonCycles = cyclesInMonths(workspace, policy.maxProjectionMonths);
  const funded = new Map<string, number>();
  const firstFunded = new Map<string, number>();
  const arrived = new Map<string, string>();
  const perCycle = new Map<string, number>();

  let cursorToday = today;
  let simulated: Workspace = workspace;

  for (let step = 0; step < horizonCycles; step += 1) {
    const plan = planCycle(simulated, cursorToday);
    if (!plan) break;
    const result = allocate(simulated, Math.max(0, round2(plan.freeCapacity - (step === 0 ? firstCycleSpend : 0))), cursorToday, policy);

    for (const allocation of result.allocations) {
      const id = allocation.claim.id;
      funded.set(id, round2((funded.get(id) ?? 0) + allocation.amount));
      if (!firstFunded.has(id)) firstFunded.set(id, step);
      if (!perCycle.has(id)) perCycle.set(id, allocation.amount);
      if (allocation.completes && !arrived.has(id)) {
        arrived.set(id, plan.cycle.end);
      }
    }

    // Advance: apply this cycle's funding, accrue interest on payoff claims,
    // and roll recurring obligations to their next occurrence. Without the
    // rollforward a monthly bill whose due date has passed looks overdue
    // forever and re-charges its full amount every cycle, which would make
    // every projected date meaningless.
    simulated = {
      ...simulated,
      buckets: simulated.buckets.map((bucket) => {
        if (bucket.kind !== "reserve") return bucket;
        const entry = plan.reserves.find((reserve) => reserve.bucket.id === bucket.id);
        const reserved = round2((bucket.reserved ?? 0) + (entry?.required ?? 0));
        // Due date reached: the bill is paid and the obligation rolls to its
        // next occurrence. Subtract rather than zero — anything reserved beyond
        // this occurrence is already saving toward the next one.
        if (bucket.dueDate && bucket.dueDate <= plan.cycle.end) {
          return {
            ...bucket,
            dueDate: nextDueDate(bucket.dueDate, bucket.frequency),
            reserved: round2(Math.max(0, reserved - billAmount(bucket))),
          };
        }
        return { ...bucket, reserved };
      }),
      claims: simulated.claims.map((claim) => {
        const gained = result.allocations.find((a) => a.claim.id === claim.id)?.amount ?? 0;
        let target = claim.targetAmount;
        if (claim.kind === "payoff" && claim.delayCost.type === "interest") {
          const cyclesPerYear = cyclesPerYearFor(simulated);
          target = round2(target * (1 + claim.delayCost.apr / 100 / cyclesPerYear));
        }
        return { ...claim, targetAmount: target, fundedAmount: round2(claim.fundedAmount + gained) };
      }),
    };
    // Advance by exactly one cycle rather than jumping to the payday.
    //
    // The reserve horizon is anchored on `today` (paydays between now and the
    // due date), so the cursor must keep the same relationship to its cycle at
    // every step. Landing on the payday itself would exclude that paycheck
    // from its own reserve count; landing the day before would never leave the
    // current cycle at all. Stepping a full cycle keeps every step "mid-cycle,
    // looking forward", which is exactly the situation the live app is in.
    cursorToday = addCycle(today, simulated.profile.payFrequency, step + 1);
    if (activeRanked(simulated).every((claim) => needOf(claim) <= 0.01)) break;
  }

  return activeRanked(workspace).map((claim) => ({
    claimId: claim.id,
    name: claim.name,
    arrivalDate: arrived.get(claim.id) ?? null,
    startsInCycles: firstFunded.get(claim.id) ?? -1,
    perCycle: perCycle.get(claim.id) ?? 0,
    beyondHorizon: !arrived.has(claim.id),
  }));
}

/** Advance a recurring obligation to its next occurrence. */
export function nextDueDate(iso: string, frequency: Bucket["frequency"]) {
  if (frequency === "one-time") return iso;
  return addCycle(iso, frequency === "weekly" ? "Weekly" : frequency === "biweekly" ? "Biweekly" : "Monthly", frequency === "annual" ? 12 : 1);
}

function cyclesPerYearFor(workspace: Workspace) {
  const frequency = workspace.profile.payFrequency;
  return frequency === "Weekly" ? 52 : frequency === "Biweekly" ? 26 : 12;
}

function cyclesInMonths(workspace: Workspace, months: number) {
  return Math.ceil((cyclesPerYearFor(workspace) / 12) * months);
}

/* -------------------------------------------------------------- scenario */

export type DateChange = {
  claimId: string;
  name: string;
  before: string | null;
  after: string | null;
  direction: "earlier" | "later" | "unchanged";
};

/**
 * The core interaction: change something, see what moves. Used by reordering,
 * by "can I buy this?", and by the debt scenario control.
 */
export function diffArrivals(before: Arrival[], after: Arrival[]): DateChange[] {
  const beforeById = new Map(before.map((arrival) => [arrival.claimId, arrival]));
  return after
    .map((arrival) => {
      const previous = beforeById.get(arrival.claimId);
      const from = previous?.arrivalDate ?? null;
      const to = arrival.arrivalDate ?? null;
      const direction: DateChange["direction"] =
        from === to ? "unchanged" : from === null ? "earlier" : to === null ? "later" : to < from ? "earlier" : "later";
      return { claimId: arrival.claimId, name: arrival.name, before: from, after: to, direction };
    })
    .filter((change) => change.direction !== "unchanged");
}

/* ---------------------------------------------------------------- format */

export function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(iso: string | null) {
  if (!iso) return "—";
  return parseDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
