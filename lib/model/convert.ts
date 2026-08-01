/**
 * LEGACY ↔ MODEL CONVERTER (Phase 1).
 *
 * `toModel` reads a stored `StewardState` into the domain model.
 * `toLegacy` writes it back, exactly.
 *
 * The pair is lossless in both directions: `toLegacy(toModel(s))` deep-equals
 * `s` for any state. That property is the Phase 1 gate, and it is what lets the
 * engine be rebuilt against the new model as a *read-time adapter* — stored
 * data is never rewritten, so every step of the redesign stays reversible.
 *
 * Two rules keep the round-trip exact:
 *
 *  1. Anything the model has no home for yet is carried verbatim in
 *     `workspace.legacy`, including original array order.
 *  2. Objects the model *derives* (debt-minimum reserves, payoff claims, the
 *     current cycle, rules) carry a `derived:` id prefix and are dropped on the
 *     way back. They are computed, not stored, so they cannot round-trip and
 *     must not try to.
 *
 * This file performs no financial reasoning. Pro-rating, free capacity, and
 * ranking policy all belong to the Phase 2 engine.
 */

import type { Bill, Budget, Goal, Project as LegacyProject, StewardState, StoredAllocation, WishlistItem } from "../steward-types";
import type {
  Bucket,
  Claim,
  Cycle,
  DelayCost,
  LegacyRemnant,
  Project,
  Rule,
  Workspace,
} from "./types";

const DERIVED = "derived:";

const isDerived = (id: string) => id.startsWith(DERIVED);

function merchantKey(merchant: string) {
  return merchant.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function paychecksPerMonth(frequency: StewardState["profile"]["payFrequency"]) {
  if (frequency === "Weekly") return 52 / 12;
  if (frequency === "Biweekly") return 26 / 12;
  return 1;
}

/* ------------------------------------------------------------- to model -- */

function bucketFromBill(bill: Bill): Bucket {
  return {
    id: `reserve:${bill.id}`,
    kind: "reserve",
    name: bill.name,
    essential: bill.essential,
    source: bill.id.startsWith("plaid-bill-") ? "plaid" : "manual",
    amountDue: bill.amount,
    dueDate: bill.dueDate,
    reserved: 0,
    frequency: bill.frequency,
    autopay: bill.autopay,
    accountId: bill.accountId,
  };
}

function bucketFromBudget(budget: Budget, frequency: StewardState["profile"]["payFrequency"]): Bucket {
  return {
    id: `spend:${budget.id}`,
    kind: "spend",
    name: budget.category,
    category: budget.category,
    essential: budget.essential,
    source: budget.source === "manual" ? "manual" : "derived",
    perCycle: budget.paycheckAmount ?? budget.planned / paychecksPerMonth(frequency),
    // Essentials roll so a lean grocery cycle isn't punished; discretionary
    // sweeps so underspending becomes visible progress. BLUEPRINT.md §C7.
    rollover: budget.essential ? "roll" : "sweep",
  };
}

/** Required minimums are obligations, not elective payoff. BLUEPRINT.md §A. */
function derivedDebtMinimumBuckets(state: StewardState): Bucket[] {
  return state.accounts
    .filter(
      (account) =>
        ["Credit card", "Loan"].includes(account.type) &&
        account.balance > 0 &&
        (account.minimumPayment ?? 0) > 0,
    )
    .map((account) => ({
      id: `${DERIVED}reserve:min:${account.id}`,
      kind: "reserve" as const,
      name: `${account.name} minimum`,
      essential: true,
      source: "derived" as const,
      amountDue: account.minimumPayment ?? 0,
      dueDate: account.dueDate,
      reserved: 0,
      frequency: "monthly" as const,
      autopay: false,
      accountId: account.id,
      linkedDebtAccountId: account.id,
    }));
}

function claimFromGoal(goal: Goal, rank: number): Claim {
  return {
    id: `claim:${goal.id}`,
    name: goal.name,
    kind: "fund",
    targetAmount: goal.target,
    fundedAmount: goal.current,
    rank,
    status:
      goal.status === "Complete" ? "complete" : goal.status === "Paused" ? "paused" : "active",
    horizon: "arrival",
    divisible: true,
    delayCost: { type: "none" },
    protected: false,
    wantBy: goal.targetDate || undefined,
  };
}

function claimFromWish(item: WishlistItem, rank: number): Claim {
  const delayCost: DelayCost = item.desiredDate
    ? { type: "deadline", date: item.desiredDate }
    : { type: "none" };
  return {
    id: `claim:${item.id}`,
    name: item.name,
    kind: "purchase",
    projectId: item.projectId ? `project:${item.projectId}` : undefined,
    targetAmount: item.price,
    fundedAmount: 0,
    rank,
    status:
      item.status === "Purchased"
        ? "complete"
        : item.status === "Rejected" || item.status === "Considering"
          ? "someday"
          : "active",
    horizon: "arrival",
    // A purchase is all-or-nothing: half a bookshelf is nothing. §C5.
    divisible: false,
    delayCost,
    protected: false,
    wantBy: item.desiredDate || undefined,
    url: item.url,
  };
}

/** Elective payoff competes below the obligation line. BLUEPRINT.md §A. */
function derivedPayoffClaims(state: StewardState, startRank: number): Claim[] {
  return state.accounts
    .filter((account) => ["Credit card", "Loan"].includes(account.type) && account.balance > 0)
    .sort((a, b) => (b.interestRate ?? 0) - (a.interestRate ?? 0))
    .map((account, index) => ({
      id: `${DERIVED}claim:payoff:${account.id}`,
      name: account.name,
      kind: "payoff" as const,
      targetAmount: account.balance,
      fundedAmount: 0,
      rank: startRank + index,
      status: "active" as const,
      horizon: "arrival" as const,
      divisible: true,
      delayCost:
        account.interestRate === undefined
          ? ({ type: "none" } as DelayCost)
          : ({ type: "interest", apr: account.interestRate } as DelayCost),
      protected: false,
      linkedAccountId: account.id,
    }));
}

function projectFrom(project: LegacyProject): Project {
  return {
    id: `project:${project.id}`,
    name: project.name,
    description: project.description || undefined,
    category: project.category || undefined,
  };
}

/**
 * The current cycle, derived from the pay profile. Cycles are computed from
 * payday cadence, not stored, so this carries the derived prefix.
 */
function derivedCurrentCycle(state: StewardState): Cycle[] {
  const { nextPayday, payFrequency, takeHomePay } = state.profile;
  if (!nextPayday) return [];
  const end = new Date(`${nextPayday}T12:00:00`);
  if (Number.isNaN(end.getTime())) return [];
  const start = new Date(end);
  if (payFrequency === "Weekly") start.setDate(start.getDate() - 7);
  else if (payFrequency === "Biweekly") start.setDate(start.getDate() - 14);
  else start.setMonth(start.getMonth() - 1);
  return [
    {
      id: `${DERIVED}cycle:${nextPayday}`,
      start: start.toISOString().slice(0, 10),
      end: nextPayday,
      expectedIncome: takeHomePay,
      actualIncome: 0,
      status: "active",
    },
  ];
}

/** Rules are re-derivable from confirmed manual categorisations. */
function derivedRules(state: StewardState): Rule[] {
  const seen = new Map<string, Rule>();
  for (const transaction of [...state.transactions].sort((a, b) =>
    b.date.localeCompare(a.date),
  )) {
    if (transaction.categorySource !== "manual" || transaction.category === "Uncategorized") {
      continue;
    }
    const key = merchantKey(transaction.merchant);
    if (seen.has(key)) continue;
    seen.set(key, {
      id: `${DERIVED}rule:${key}`,
      merchantKey: key,
      category: transaction.category,
      createdAt: transaction.date,
    });
  }
  return [...seen.values()];
}

export function toModel(state: StewardState): Workspace {
  const goalMeta: Record<string, unknown> = {};
  const wishlistMeta: Record<string, unknown> = {};
  const projectMeta: Record<string, unknown> = {};
  const budgetMeta: Record<string, unknown> = {};
  const billMeta: Record<string, unknown> = {};

  for (const bill of state.bills) billMeta[bill.id] = { paid: bill.paid };
  for (const budget of state.budgets) {
    budgetMeta[budget.id] = {
      planned: budget.planned,
      actual: budget.actual,
      cadence: budget.cadence,
      source: budget.source,
      paycheckAmount: budget.paycheckAmount,
    };
  }
  for (const goal of state.goals) {
    goalMeta[goal.id] = {
      type: goal.type,
      priority: goal.priority,
      status: goal.status,
      targetDate: goal.targetDate,
      recommendedContribution: goal.recommendedContribution,
      paycheckContribution: goal.paycheckContribution,
    };
  }
  for (const project of state.projects) {
    projectMeta[project.id] = {
      priority: project.priority,
      status: project.status,
      targetDate: project.targetDate,
      estimatedCost: project.estimatedCost,
      actualCost: project.actualCost,
      paycheckContribution: project.paycheckContribution,
      progress: project.progress,
      nextAction: project.nextAction,
      tasks: project.tasks,
    };
  }
  for (const item of state.wishlist) {
    wishlistMeta[item.id] = {
      category: item.category,
      priority: item.priority,
      desiredDate: item.desiredDate,
      safeDate: item.safeDate,
      status: item.status,
      reason: item.reason,
    };
  }

  const storedAllocations = state.allocations ?? [];
  const confirmedByClaim = new Map<string, number>();
  for (const row of storedAllocations) {
    if (row.status !== "confirmed") continue;
    confirmedByClaim.set(row.claimId, (confirmedByClaim.get(row.claimId) ?? 0) + row.amount);
  }

  // A claim's funding is its stored base plus every CONFIRMED allocation.
  // Proposed rows are deliberately excluded: a payday plan the user never
  // confirmed must leave funding untouched.
  const withConfirmed = (claim: Claim): Claim => ({
    ...claim,
    fundedAmount:
      Math.round((claim.fundedAmount + (confirmedByClaim.get(claim.id) ?? 0)) * 100) / 100,
  });

  const storedClaims: Claim[] = [
    ...state.goals.map((goal, index) => withConfirmed(claimFromGoal(goal, index))),
    ...state.wishlist.map((item, index) =>
      withConfirmed(claimFromWish(item, state.goals.length + index)),
    ),
  ];

  const legacy: LegacyRemnant = {
    version: state.version,
    riskTolerance: state.profile.riskTolerance,
    budgetingStyle: state.profile.budgetingStyle,
    paycheckPlan: state.paycheckPlan as unknown as Record<string, number | string>,
    recommendations: state.recommendations,
    memories: state.memories,
    reviews: state.reviews,
    notifications: state.notifications,
    notificationPreferences: state.notificationPreferences,
    goalMeta,
    projectMeta,
    wishlistMeta,
    budgetMeta,
    billMeta,
    order: {
      bills: state.bills.map((bill) => bill.id),
      budgets: state.budgets.map((budget) => budget.id),
      goals: state.goals.map((goal) => goal.id),
      projects: state.projects.map((project) => project.id),
      wishlist: state.wishlist.map((item) => item.id),
    },
  };

  return {
    modelVersion: 1,
    profile: {
      name: state.profile.name,
      email: state.profile.email,
      currency: state.profile.currency,
      payFrequency: state.profile.payFrequency,
      nextPayday: state.profile.nextPayday,
      takeHomePay: state.profile.takeHomePay,
      bufferFloor: state.profile.minimumBuffer,
      theme: state.profile.theme,
      onboardingComplete: state.profile.onboardingComplete,
    },
    accounts: state.accounts,
    transactions: state.transactions,
    cycles: derivedCurrentCycle(state),
    buckets: [
      ...state.bills.map(bucketFromBill),
      ...state.budgets.map((budget) => bucketFromBudget(budget, state.profile.payFrequency)),
      ...derivedDebtMinimumBuckets(state),
    ],
    claims: [...storedClaims, ...derivedPayoffClaims(state, storedClaims.length)],
    projects: state.projects.map(projectFrom),
    allocations: storedAllocations.map((row) => ({
      id: row.id,
      cycleId: row.cycleId,
      targetType: "claim" as const,
      targetId: row.claimId,
      amount: row.amount,
      status: row.status,
      createdAt: row.createdAt,
    })),
    rules: derivedRules(state),
    legacy,
  };
}

/* ------------------------------------------------------------ to legacy -- */

const stripPrefix = (id: string, prefix: string) =>
  id.startsWith(prefix) ? id.slice(prefix.length) : id;

/**
 * Drop keys whose value is `undefined`.
 *
 * The workspace is persisted as JSON, which discards undefined-valued keys, so
 * an object that has been saved and reloaded never carries them. `toLegacy`
 * must produce that same canonical shape — otherwise it emits `paid: undefined`
 * where the stored record simply had no `paid` key, and the round-trip is not
 * actually lossless even though every value matches.
 */
function compact<T extends object>(value: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) result[key] = entry;
  }
  return result as T;
}

export function toLegacy(workspace: Workspace): StewardState {
  const { legacy } = workspace;

  const confirmedByClaim = new Map<string, number>();
  for (const row of workspace.allocations) {
    if (row.status !== "confirmed" || row.targetType !== "claim") continue;
    confirmedByClaim.set(row.targetId, (confirmedByClaim.get(row.targetId) ?? 0) + row.amount);
  }
  const baseFunded = (claim: { id: string; fundedAmount: number }) =>
    Math.round((claim.fundedAmount - (confirmedByClaim.get(claim.id) ?? 0)) * 100) / 100;

  const bucketById = new Map(workspace.buckets.map((bucket) => [bucket.id, bucket]));
  const claimById = new Map(workspace.claims.map((claim) => [claim.id, claim]));
  const projectById = new Map(workspace.projects.map((project) => [project.id, project]));

  const bills: Bill[] = legacy.order.bills.map((id) => {
    const bucket = bucketById.get(`reserve:${id}`)!;
    const meta = (legacy.billMeta[id] ?? {}) as { paid?: boolean };
    return compact({
      id,
      name: bucket.name,
      amount: bucket.amountDue ?? 0,
      dueDate: bucket.dueDate ?? "",
      frequency: bucket.frequency ?? "monthly",
      autopay: bucket.autopay ?? false,
      essential: bucket.essential,
      accountId: bucket.accountId ?? "",
      paid: meta.paid,
    });
  });

  const budgets: Budget[] = legacy.order.budgets.map((id) => {
    const bucket = bucketById.get(`spend:${id}`)!;
    const meta = (legacy.budgetMeta[id] ?? {}) as {
      planned?: number;
      actual?: number;
      cadence?: Budget["cadence"];
      source?: Budget["source"];
      paycheckAmount?: number;
    };
    return compact({
      id,
      category: bucket.category ?? bucket.name,
      planned: meta.planned ?? 0,
      actual: meta.actual ?? 0,
      cadence: meta.cadence ?? "Monthly",
      essential: bucket.essential,
      source: meta.source,
      paycheckAmount: meta.paycheckAmount,
    });
  });

  const goals: Goal[] = legacy.order.goals.map((id) => {
    const claim = claimById.get(`claim:${id}`)!;
    const meta = (legacy.goalMeta[id] ?? {}) as {
      type?: string;
      priority?: Goal["priority"];
      status?: Goal["status"];
      targetDate?: string;
      recommendedContribution?: number;
      paycheckContribution?: number;
    };
    return compact({
      id,
      name: claim.name,
      type: meta.type ?? "Custom",
      target: claim.targetAmount,
      current: baseFunded(claim),
      targetDate: meta.targetDate ?? "",
      priority: meta.priority ?? "Medium",
      status: meta.status ?? "Active",
      recommendedContribution: meta.recommendedContribution ?? 0,
      paycheckContribution: meta.paycheckContribution,
    });
  });

  const projects: LegacyProject[] = legacy.order.projects.map((id) => {
    const project = projectById.get(`project:${id}`)!;
    const meta = (legacy.projectMeta[id] ?? {}) as Record<string, unknown>;
    return compact({
      id,
      name: project.name,
      description: project.description ?? "",
      category: project.category ?? "",
      priority: meta.priority as LegacyProject["priority"],
      status: meta.status as LegacyProject["status"],
      targetDate: meta.targetDate as string,
      estimatedCost: meta.estimatedCost as number,
      actualCost: meta.actualCost as number,
      paycheckContribution: meta.paycheckContribution as number | undefined,
      progress: meta.progress as number,
      nextAction: meta.nextAction as string,
      tasks: meta.tasks as LegacyProject["tasks"],
    });
  });

  const wishlist: WishlistItem[] = legacy.order.wishlist.map((id) => {
    const claim = claimById.get(`claim:${id}`)!;
    const meta = (legacy.wishlistMeta[id] ?? {}) as Record<string, unknown>;
    return compact({
      id,
      name: claim.name,
      projectId: claim.projectId ? stripPrefix(claim.projectId, "project:") : undefined,
      category: meta.category as string,
      priority: meta.priority as WishlistItem["priority"],
      price: claim.targetAmount,
      desiredDate: meta.desiredDate as string,
      safeDate: meta.safeDate as string,
      status: meta.status as WishlistItem["status"],
      reason: meta.reason as string,
      url: claim.url,
    });
  });

  // Buckets created after load (onboarding, or adding a bill) are absent from
  // the recorded order and would be dropped on write, exactly as claims were.
  const knownBuckets = new Set([
    ...legacy.order.bills.map((id) => `reserve:${id}`),
    ...legacy.order.budgets.map((id) => `spend:${id}`),
  ]);
  for (const bucket of workspace.buckets) {
    if (isDerived(bucket.id) || knownBuckets.has(bucket.id)) continue;
    if (bucket.kind === "reserve") {
      bills.push(
        compact({
          id: stripPrefix(bucket.id, "reserve:"),
          name: bucket.name,
          amount: bucket.amountDue ?? 0,
          dueDate: bucket.dueDate ?? "",
          frequency: bucket.frequency ?? "monthly",
          autopay: bucket.autopay ?? false,
          essential: bucket.essential,
          accountId: bucket.accountId ?? "",
        }) as Bill,
      );
    } else {
      budgets.push(
        compact({
          id: stripPrefix(bucket.id, "spend:"),
          category: bucket.category ?? bucket.name,
          planned: 0,
          actual: 0,
          cadence: "Monthly",
          essential: bucket.essential,
          source: "manual",
          paycheckAmount: bucket.perCycle,
        }) as Budget,
      );
    }
  }

  // Claims created after load have no entry in the recorded order, so they
  // would otherwise be dropped on write. Give each one a legacy home: a
  // purchase becomes a wishlist item, anything else becomes a goal. On the
  // next read they arrive through the normal path.
  const known = new Set([
    ...legacy.order.goals.map((id) => `claim:${id}`),
    ...legacy.order.wishlist.map((id) => `claim:${id}`),
  ]);
  for (const claim of workspace.claims) {
    if (isDerived(claim.id) || known.has(claim.id)) continue;
    const id = stripPrefix(claim.id, "claim:");
    if (claim.kind === "purchase") {
      wishlist.push(
        compact({
          id,
          name: claim.name,
          projectId: claim.projectId ? stripPrefix(claim.projectId, "project:") : undefined,
          category: "Uncategorized",
          priority: "Medium",
          price: claim.targetAmount,
          desiredDate: claim.wantBy ?? "",
          safeDate: "",
          status: claim.status === "someday" ? "Considering" : "Planned",
          reason: "Added in Steward.",
          url: claim.url,
        }) as WishlistItem,
      );
    } else {
      goals.push(
        compact({
          id,
          name: claim.name,
          type: claim.kind === "payoff" ? "Debt payoff" : "Custom",
          target: claim.targetAmount,
          current: baseFunded(claim),
          targetDate: claim.wantBy ?? "",
          priority: "Medium",
          status: claim.status === "paused" ? "Paused" : claim.status === "complete" ? "Complete" : "Active",
          recommendedContribution: 0,
          paycheckContribution: claim.pinned,
        }) as Goal,
      );
    }
  }

  return {
    version: legacy.version,
    profile: {
      name: workspace.profile.name,
      email: workspace.profile.email,
      currency: workspace.profile.currency,
      nextPayday: workspace.profile.nextPayday,
      payFrequency: workspace.profile.payFrequency,
      takeHomePay: workspace.profile.takeHomePay,
      minimumBuffer: workspace.profile.bufferFloor,
      riskTolerance: legacy.riskTolerance,
      budgetingStyle: legacy.budgetingStyle,
      theme: workspace.profile.theme,
      onboardingComplete: workspace.profile.onboardingComplete,
    },
    accounts: workspace.accounts,
    transactions: workspace.transactions,
    bills,
    goals,
    projects,
    wishlist,
    recommendations: legacy.recommendations as StewardState["recommendations"],
    paycheckPlan: legacy.paycheckPlan as unknown as StewardState["paycheckPlan"],
    budgets,
    memories: legacy.memories as StewardState["memories"],
    reviews: legacy.reviews as StewardState["reviews"],
    notifications: legacy.notifications as StewardState["notifications"],
    notificationPreferences: legacy.notificationPreferences,
    ...(workspace.allocations.length
      ? {
          allocations: workspace.allocations
            .filter((row) => row.targetType === "claim")
            .map<StoredAllocation>((row) => ({
              id: row.id,
              cycleId: row.cycleId,
              claimId: row.targetId,
              amount: row.amount,
              status: row.status,
              createdAt: row.createdAt,
            })),
        }
      : {}),
  };
}

/* --------------------------------------------------------------- helpers -- */

/** Objects the model computes rather than stores. Excluded from round-trip. */
export function storedOnly<T extends { id: string }>(items: T[]): T[] {
  return items.filter((item) => !isDerived(item.id));
}

/** Objects the model derived from stored data this read. */
export function derivedOnly<T extends { id: string }>(items: T[]): T[] {
  return items.filter((item) => isDerived(item.id));
}
