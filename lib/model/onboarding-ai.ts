/**
 * AI-LED ONBOARDING
 *
 * The model owns the interview: it can ask concise follow-ups, collect any
 * number of goals, and negotiate among real spending levers. The application
 * still owns every financial fact and mutation. This module builds the model's
 * context, validates its structured state, previews the resulting budget, and
 * commits only changes that correspond to known accounts, buckets, or charges.
 */

import { buildPaydayProposal, confirmProposal, supersedeStaleProposals } from "./decide";
import { formatMoney, planCycle } from "./engine";
import { allowedNumerals, outputIsGrounded } from "./ai";
import {
  annualCost,
  incomeObservations,
  spendingByCategory,
  subscriptions,
} from "./observations";
import type { Claim, Workspace } from "./types";

export type OnboardingRole = "assistant" | "user";

export type OnboardingTurn = {
  role: OnboardingRole;
  content: string;
};

export type OnboardingGoal = {
  id: string;
  name: string;
  kind: "purchase" | "payoff" | "fund" | "commitment";
  targetAmount: number | null;
  targetDate: string | null;
  linkedAccountId: string | null;
  detailsComplete: boolean;
};

export type CheckInCadence = "daily" | "every_other_day" | "weekly";

export type AIOnboardingState = {
  goals: OnboardingGoal[];
  goalCollectionComplete: boolean;
  prioritiesConfirmed: boolean;
  incomeConfirmed: boolean | null;
  recurringReviewed: boolean;
  acceptedStrategyIds: string[];
  declinedStrategyIds: string[];
  strategyComplete: boolean;
  budgetAccepted: boolean;
  checkInCadence: CheckInCadence | null;
  complete: boolean;
};

export const EMPTY_AI_ONBOARDING_STATE: AIOnboardingState = {
  goals: [],
  goalCollectionComplete: false,
  prioritiesConfirmed: false,
  incomeConfirmed: null,
  recurringReviewed: false,
  acceptedStrategyIds: [],
  declinedStrategyIds: [],
  strategyComplete: false,
  budgetAccepted: false,
  checkInCadence: null,
  complete: false,
};

/** Binary decisions are complete answers; choice lists remain editable. */
export function onboardingReplySubmitsImmediately(reply: string) {
  return /^(yes|no|accept|decline)\b/i.test(reply.trim());
}

export type OnboardingStrategy = {
  id: string;
  kind: "cut_bucket" | "cancel_subscription";
  label: string;
  targetId: string;
  fromAmount: number;
  toAmount: number;
  freesPerPaycheck: number;
  yearlySavings: number;
};

export type AIOnboardingContext = {
  today: string;
  scanComplete: boolean;
  paycheck: {
    amount: number;
    cadence: string;
    merchant: string | null;
  };
  accounts: {
    id: string;
    name: string;
    type: string;
    balance: number;
    apr: number | null;
    minimumPayment: number | null;
  }[];
  monthlySpending: {
    category: string;
    amount: number;
    merchants: string[];
  }[];
  recurringCharges: {
    id: string;
    merchant: string;
    amount: number;
    cadence: string;
    yearlyCost: number;
  }[];
  currentBudget: {
    incomePerPaycheck: number;
    billsAndMinimums: number;
    flexibleSpending: number;
    freePerPaycheck: number;
    buckets: { id: string; name: string; amount: number; essential: boolean }[];
  };
  strategies: OnboardingStrategy[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const clean = (value: unknown, max = 120) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
const slug = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "goal";

function paychecksPerYear(workspace: Workspace) {
  return workspace.profile.payFrequency === "Weekly"
    ? 52
    : workspace.profile.payFrequency === "Monthly"
      ? 12
      : 26;
}

/** Real, bounded changes Steward may negotiate. The model can select; it cannot invent. */
export function onboardingStrategies(workspace: Workspace, today: string): OnboardingStrategy[] {
  const cutStrategies = workspace.buckets
    .filter((bucket) => bucket.kind === "spend" && !bucket.essential && (bucket.perCycle ?? 0) > 0)
    .sort((a, b) => (b.perCycle ?? 0) - (a.perCycle ?? 0))
    .flatMap((bucket) => {
      const current = bucket.perCycle ?? 0;
      return [0.25, 0.4].map((rate) => {
        const next = Math.max(0, Math.round(current * (1 - rate)));
        const freed = round2(current - next);
        return {
          id: `cut:${bucket.id}:${Math.round(rate * 100)}`,
          kind: "cut_bucket" as const,
          label: `Bring ${bucket.name} from ${formatMoney(current)} to ${formatMoney(next)} per paycheck`,
          targetId: bucket.id,
          fromAmount: current,
          toAmount: next,
          freesPerPaycheck: freed,
          yearlySavings: round2(freed * paychecksPerYear(workspace)),
        };
      });
    });

  const cancelStrategies = subscriptions(workspace, today).slice(0, 5).map((stream) => {
    const yearly = annualCost(stream);
    return {
      id: `cancel:${stream.key}`,
      kind: "cancel_subscription" as const,
      label: `Cancel ${stream.merchant}`,
      targetId: stream.key,
      fromAmount: stream.typicalAmount,
      toAmount: 0,
      freesPerPaycheck: round2(yearly / paychecksPerYear(workspace)),
      yearlySavings: yearly,
    };
  });

  return [...cutStrategies, ...cancelStrategies];
}

function withRecurringBudgets(
  workspace: Workspace,
  today: string,
  cancelledIds = new Set<string>(),
): Workspace {
  const existingNames = new Set(
    workspace.buckets
      .filter((bucket) => bucket.kind === "spend")
      .flatMap((bucket) => [bucket.name.toLowerCase(), bucket.category?.toLowerCase() ?? ""]),
  );
  const additions = subscriptions(workspace, today)
    .filter((stream) => !cancelledIds.has(`cancel:${stream.key}`))
    .filter(
      (stream) =>
        !existingNames.has(stream.merchant.toLowerCase()) &&
        !existingNames.has(stream.category.toLowerCase()),
    )
    .map((stream) => ({
      id: `bucket:onboarding:${slug(stream.key)}`,
      kind: "spend" as const,
      name: stream.merchant,
      category: stream.category,
      essential: false,
      source: "derived" as const,
      perCycle: round2(annualCost(stream) / paychecksPerYear(workspace)),
      rollover: "sweep" as const,
    }));
  return additions.length
    ? { ...workspace, buckets: [...workspace.buckets, ...additions] }
    : workspace;
}

/** A compact, fully computed snapshot sent on every AI turn. */
export function buildAIOnboardingContext(
  workspace: Workspace,
  today: string,
  scanComplete: boolean,
): AIOnboardingContext {
  const income = incomeObservations(workspace, today).primary;
  const budgetWorkspace = withRecurringBudgets(workspace, today);
  const plan = planCycle(budgetWorkspace, today);
  const recurring = subscriptions(workspace, today).slice(0, 8);

  return {
    today,
    scanComplete,
    paycheck: {
      amount: income?.typicalAmount ?? workspace.profile.takeHomePay,
      cadence: income?.cadence ?? workspace.profile.payFrequency.toLowerCase(),
      merchant: income?.merchant ?? null,
    },
    accounts: workspace.accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      balance: account.balance,
      apr: account.interestRate ?? null,
      minimumPayment: account.minimumPayment ?? null,
    })),
    monthlySpending: spendingByCategory(workspace, today)
      .slice(0, 10)
      .map((entry) => ({
        category: entry.category,
        amount: round2(entry.total / 3),
        merchants: entry.merchants.slice(0, 3),
      })),
    recurringCharges: recurring.map((stream) => ({
      id: stream.key,
      merchant: stream.merchant,
      amount: stream.typicalAmount,
      cadence: stream.cadence,
      yearlyCost: annualCost(stream),
    })),
    currentBudget: {
      incomePerPaycheck: plan?.income ?? workspace.profile.takeHomePay,
      billsAndMinimums: plan?.reservesTotal ?? 0,
      flexibleSpending: plan?.spendTotal ?? 0,
      freePerPaycheck: plan?.freeCapacity ?? 0,
      buckets: budgetWorkspace.buckets
        .filter((bucket) => bucket.kind === "spend")
        .map((bucket) => ({
          id: bucket.id,
          name: bucket.name,
          amount: bucket.perCycle ?? 0,
          essential: bucket.essential,
        })),
    },
    strategies: onboardingStrategies(workspace, today),
  };
}

function spokenNumerals(conversation: OnboardingTurn[]) {
  return allowedNumerals(
    conversation.filter((turn) => turn.role === "user").map((turn) => turn.content),
  );
}

/**
 * Treat model output as a proposal. Unknown accounts, strategies, amounts and
 * cadence values are removed before state reaches the product.
 */
export function normalizeAIOnboardingState(
  value: unknown,
  previous: AIOnboardingState,
  context: AIOnboardingContext,
  conversation: OnboardingTurn[],
): AIOnboardingState {
  const candidate = value && typeof value === "object"
    ? value as Partial<AIOnboardingState>
    : {};
  const knownAccounts = new Set(context.accounts.map((account) => account.id));
  const knownStrategies = new Set(context.strategies.map((strategy) => strategy.id));
  const userNumbers = spokenNumerals(conversation);
  const userText = conversation
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.toLowerCase())
    .join(" ");
  const kinds = new Set<OnboardingGoal["kind"]>(["purchase", "payoff", "fund", "commitment"]);
  const lastUserIndex = conversation.map((turn) => turn.role).lastIndexOf("user");
  const lastUser = lastUserIndex >= 0 ? conversation[lastUserIndex].content.toLowerCase() : "";
  const priorAssistant = lastUserIndex > 0
    ? [...conversation.slice(0, lastUserIndex)].reverse().find((turn) => turn.role === "assistant")?.content.toLowerCase() ?? ""
    : "";
  const affirmative = /\b(yes|yeah|yep|right|correct|keep|use|works|okay|ok|deal|accept|good|sounds good|do it)\b/i.test(lastUser);
  const negative = /\b(no|nope|wrong|another|different|decline|reject|don'?t|do not|not that)\b/i.test(lastUser);
  const strategyNegative = negative || /\b(keep|leave)\b.{0,28}\b(current|unchanged|same)\b/i.test(lastUser);

  const proposedGoals = Array.isArray(candidate.goals) ? candidate.goals : previous.goals;
  const goals = proposedGoals.slice(0, 10).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const goal = raw as Partial<OnboardingGoal>;
    const name = clean(goal.name);
    if (!name || !kinds.has(goal.kind as OnboardingGoal["kind"])) return [];
    const targetAmount =
      typeof goal.targetAmount === "number" &&
      Number.isFinite(goal.targetAmount) &&
      goal.targetAmount > 0 &&
      userNumbers.has(String(round2(goal.targetAmount)))
        ? round2(goal.targetAmount)
        : null;
    const linked = typeof goal.linkedAccountId === "string"
      ? context.accounts.find((account) => account.id === goal.linkedAccountId)
      : undefined;
    const allDebt = /\b(all|every|both)\b.{0,20}\b(debt|card|loan)/i.test(userText);
    const accountNamed = linked
      ? linked.name.toLowerCase().split(/\s+/).filter((word) => word.length > 3)
          .some((word) => userText.includes(word))
      : false;
    const accountTypeNamed = linked?.type === "Credit card"
      ? /\b(card|credit)\b/i.test(userText)
      : linked?.type === "Loan"
        ? /\bloan\b/i.test(userText)
        : false;
    const linkedAccountId = linked && knownAccounts.has(linked.id) && (allDebt || accountNamed || accountTypeNamed)
      ? linked.id
      : null;
    const proposedDate = clean(goal.targetDate, 20) || null;
    const targetDate = proposedDate && outputIsGrounded(proposedDate, userNumbers) ? proposedDate : null;
    const previousGoal = previous.goals.find((entry) =>
      entry.id === goal.id || entry.name.toLowerCase() === name.toLowerCase());
    const genericGoal = /^(buy something|purchase|pay off debt|debt|build savings|savings|save money|more breathing room|breathing room)$/i.test(name);
    const amountWasDeclined = /\b(not sure|don'?t know|no idea|unsure)\b/i.test(lastUser) &&
      /\b(amount|cost|how much|roughly)\b/i.test(priorAssistant);
    const hasEnoughDetail = Boolean(previousGoal?.detailsComplete) || (!genericGoal && (
      (goal.kind === "payoff" && linkedAccountId !== null) ||
      targetAmount !== null ||
      amountWasDeclined
    ));
    return [{
      id: clean(goal.id, 80) || `goal:${slug(name)}:${index}`,
      name,
      kind: goal.kind as OnboardingGoal["kind"],
      targetAmount,
      targetDate,
      linkedAccountId,
      // "I'm not sure" is still a complete answer to an amount question. The
      // model occasionally preserved detailsComplete=false even after moving
      // on, which left the product rail on Goals while it asked about income.
      detailsComplete: (Boolean(goal.detailsComplete) || amountWasDeclined) && hasEnoughDetail,
    }];
  });

  const proposedAccepted = (Array.isArray(candidate.acceptedStrategyIds)
    ? candidate.acceptedStrategyIds
    : previous.acceptedStrategyIds)
    .filter((id): id is string => typeof id === "string" && knownStrategies.has(id));
  const strategyWasDiscussed = (id: string) => {
    const strategy = context.strategies.find((entry) => entry.id === id);
    if (!strategy) return false;
    const target = strategy.kind === "cut_bucket"
      ? context.currentBudget.buckets.find((bucket) => bucket.id === strategy.targetId)?.name
      : context.recurringCharges.find((charge) => charge.id === strategy.targetId)?.merchant;
    if (!target || !priorAssistant.includes(target.toLowerCase())) return false;
    return strategy.kind === "cancel_subscription" ||
      allowedNumerals([priorAssistant]).has(String(strategy.toAmount));
  };
  const discussedStrategyIds = context.strategies
    .filter((strategy) => strategyWasDiscussed(strategy.id))
    .map((strategy) => strategy.id);
  const inferredAccepted = affirmative && !strategyNegative && discussedStrategyIds.length === 1
    ? discussedStrategyIds
    : [];
  const accepted = [...new Set([...proposedAccepted, ...inferredAccepted])].filter(
    (id) => previous.acceptedStrategyIds.includes(id) || (strategyWasDiscussed(id) && affirmative && !strategyNegative),
  );
  const acceptedSet = new Set(accepted);
  const inferredDeclined = strategyNegative && discussedStrategyIds.length === 1
    ? discussedStrategyIds
    : [];
  const declined = [...new Set([...(Array.isArray(candidate.declinedStrategyIds)
    ? candidate.declinedStrategyIds
    : previous.declinedStrategyIds), ...inferredDeclined])]
    .filter((id): id is string =>
      typeof id === "string" &&
      knownStrategies.has(id) &&
      !acceptedSet.has(id) &&
      (previous.declinedStrategyIds.includes(id) || (strategyWasDiscussed(id) && strategyNegative)));
  const askedAboutIncome = /\b(paycheck|income|paid|pay)\b/i.test(priorAssistant);
  const askedAboutRecurring =
    /\b(recurring|subscription|charge|keep|cancel)\b/i.test(priorAssistant) ||
    context.recurringCharges.some((charge) => priorAssistant.includes(charge.merchant.toLowerCase()));
  const reviewingSingleCharge =
    /\b(still use|keep|cancel)\b/i.test(priorAssistant) &&
    context.recurringCharges.some((charge) => priorAssistant.includes(charge.merchant.toLowerCase()));
  const incomeConfirmed = previous.incomeConfirmed === true
    ? true
    : askedAboutIncome && affirmative && !negative
      ? true
      : askedAboutIncome && negative
        ? false
        : previous.incomeConfirmed;
  const recurringReviewed = context.recurringCharges.length === 0 || previous.recurringReviewed ||
    (askedAboutRecurring && affirmative && !negative) ||
    (reviewingSingleCharge && (affirmative || negative));
  const askedAboutBudget = /\b(budget|plan)\b/i.test(priorAssistant);
  const budgetAccepted = previous.budgetAccepted ||
    (Boolean(candidate.budgetAccepted) && askedAboutBudget && affirmative && !negative);
  const askedAboutCadence = /\b(check.?in|daily|weekly|every other day|how often)\b/i.test(priorAssistant);
  const checkInCadence: CheckInCadence | null = previous.checkInCadence ?? (
    askedAboutCadence && /every other day/i.test(lastUser)
      ? "every_other_day"
      : askedAboutCadence && /\bdaily\b/i.test(lastUser)
        ? "daily"
        : askedAboutCadence && /\bweekly\b/i.test(lastUser)
          ? "weekly"
          : null
  );
  const keepCurrentSpending = /\b(keep|leave)\b.{0,24}\b(spending|budget|things|same|current)\b/i.test(lastUser);
  const reopenStrategy = askedAboutBudget && /\b(no|change|different|another|tradeoff)\b/i.test(lastUser);
  const strategyComplete = !reopenStrategy && (
    previous.strategyComplete ||
    accepted.length > 0 ||
    (Boolean(candidate.strategyComplete) && keepCurrentSpending) ||
    (Boolean(candidate.strategyComplete) && context.strategies.length === 0)
  );

  const askedForAnotherGoal = /\b(another goal|anything else|add another)\b/i.test(priorAssistant);
  const finishedListingGoals = /\b(that['’]?s|that is) (everything|all)|\bno (more|other)|\bdone\b/i.test(lastUser) ||
    /^no\b/i.test(lastUser);
  const correctingGoal = /\b(i said|instead|not that|change|wrong)\b/i.test(lastUser) ||
    /^no\b/i.test(lastUser) && !finishedListingGoals;
  const goalCollectionComplete = !correctingGoal && (previous.goalCollectionComplete || (
    Boolean(candidate.goalCollectionComplete) &&
    goals.length > 0 &&
    goals.every((goal) => goal.detailsComplete) &&
    askedForAnotherGoal &&
    finishedListingGoals
  ));
  const askedAboutPriority = /\b(priority|priorities|first|most important|order)\b/i.test(priorAssistant);
  const prioritiesConfirmed = goals.length < 2 || previous.prioritiesConfirmed || (
    Boolean(candidate.prioritiesConfirmed) && askedAboutPriority && lastUser.length > 0
  );

  const state: AIOnboardingState = {
    goals,
    goalCollectionComplete,
    prioritiesConfirmed,
    incomeConfirmed,
    recurringReviewed,
    acceptedStrategyIds: [...new Set(accepted)],
    declinedStrategyIds: [...new Set(declined)],
    strategyComplete,
    budgetAccepted,
    checkInCadence,
    complete: false,
  };

  const goalsReady =
    state.goals.length > 0 &&
    state.goalCollectionComplete &&
    state.prioritiesConfirmed &&
    state.goals.every((goal) => goal.detailsComplete);
  const financesReady =
    !context.scanComplete ||
    (state.incomeConfirmed === true && state.recurringReviewed);
  state.complete = Boolean(
    candidate.complete &&
    context.scanComplete &&
    goalsReady &&
    financesReady &&
    state.strategyComplete &&
    state.budgetAccepted &&
    state.checkInCadence,
  );
  return state;
}

export type OnboardingPhase = "goals" | "review" | "strategy" | "budget" | "checkin" | "complete";

export function onboardingPhase(
  state: AIOnboardingState,
  context: AIOnboardingContext,
): OnboardingPhase {
  const goalsReady =
    state.goals.length > 0 &&
    state.goalCollectionComplete &&
    state.prioritiesConfirmed &&
    state.goals.every((goal) => goal.detailsComplete);
  if (!goalsReady) return "goals";
  if (!context.scanComplete || state.incomeConfirmed !== true || !state.recurringReviewed) return "review";
  if (!state.strategyComplete) return "strategy";
  if (!state.budgetAccepted) return "budget";
  if (!state.checkInCadence) return "checkin";
  return state.complete ? "complete" : "checkin";
}

/** Apply only accepted, known levers to a preview workspace. */
export function previewAIOnboarding(
  workspace: Workspace,
  today: string,
  state: AIOnboardingState,
): Workspace {
  const strategyById = new Map(onboardingStrategies(workspace, today).map((entry) => [entry.id, entry]));
  const selected = state.acceptedStrategyIds
    .map((id) => strategyById.get(id))
    .filter((entry): entry is OnboardingStrategy => Boolean(entry));

  const cancelled = new Set(
    selected
      .filter((strategy) => strategy.kind === "cancel_subscription")
      .map((strategy) => strategy.id),
  );
  const budgetWorkspace = withRecurringBudgets(workspace, today, cancelled);
  const next: Workspace = {
    ...budgetWorkspace,
    buckets: budgetWorkspace.buckets.map((bucket) => {
      const cuts = selected.filter(
        (strategy) => strategy.kind === "cut_bucket" && strategy.targetId === bucket.id,
      );
      if (!cuts.length || bucket.kind !== "spend") return bucket;
      return { ...bucket, perCycle: Math.min(...cuts.map((strategy) => strategy.toAmount)) };
    }),
  };

  const added: Claim[] = [];
  const prioritizedExisting = new Map<string, number>();
  for (const [index, goal] of state.goals.entries()) {
    if (goal.kind === "payoff" && goal.linkedAccountId) {
      const existing = next.claims.find(
        (claim) => claim.kind === "payoff" && claim.linkedAccountId === goal.linkedAccountId,
      );
      if (existing) prioritizedExisting.set(existing.id, index);
      continue;
    }
    if (next.claims.some((claim) => claim.name.toLowerCase() === goal.name.toLowerCase())) continue;
    const target = goal.targetAmount ?? 0;
    const kind = goal.kind;
    added.push({
      id: `claim:intake-ai:${slug(goal.name)}:${index}`,
      name: goal.name,
      kind,
      targetAmount: target,
      fundedAmount: 0,
      rank: index,
      status: target > 0 ? "active" : "someday",
      horizon: kind === "commitment" ? "commitment" : "arrival",
      divisible: kind !== "purchase",
      delayCost: goal.targetDate
        ? { type: "deadline", date: goal.targetDate }
        : { type: "none" },
      protected: false,
      wantBy: goal.targetDate ?? undefined,
    });
  }
  const unselected = next.claims
    .filter((claim) => !prioritizedExisting.has(claim.id))
    .sort((a, b) => a.rank - b.rank);
  const fallbackRanks = new Map(
    unselected.map((claim, index) => [claim.id, state.goals.length + index]),
  );
  return {
    ...next,
    claims: [
      ...next.claims.map((claim) => ({
        ...claim,
        rank: prioritizedExisting.get(claim.id) ?? fallbackRanks.get(claim.id) ?? claim.rank,
        status: prioritizedExisting.has(claim.id) ? "active" as const : claim.status,
      })),
      ...added,
    ],
  };
}

export function acceptedCancellationStrategies(
  workspace: Workspace,
  today: string,
  state: AIOnboardingState,
) {
  const accepted = new Set(state.acceptedStrategyIds);
  return onboardingStrategies(workspace, today).filter(
    (strategy) => strategy.kind === "cancel_subscription" && accepted.has(strategy.id),
  );
}

/** Finish onboarding, persist cadence, and confirm the reviewed first plan. */
export function acceptAIOnboarding(
  workspace: Workspace,
  today: string,
  state: AIOnboardingState,
  now = new Date().toISOString(),
): Workspace {
  const preview = previewAIOnboarding(workspace, today, state);
  const cadence = state.checkInCadence ?? "weekly";
  const completed: Workspace = {
    ...preview,
    profile: { ...preview.profile, onboardingComplete: true },
    legacy: {
      ...preview.legacy,
      notificationPreferences: {
        ...preview.legacy.notificationPreferences,
        dailyCheckIn: cadence === "daily",
        everyOtherDayCheckIn: cadence === "every_other_day",
        weeklyReview: cadence === "weekly",
      },
    },
  };
  const proposal = buildPaydayProposal(completed, today);
  if (!proposal || proposal.freeCapacity <= 0 || proposal.lines.length === 0) return completed;
  return confirmProposal(supersedeStaleProposals(completed, proposal.cycleId), proposal, now);
}

/** Numeric facts the model may repeat in prose. */
export function onboardingAllowedNumerals(
  context: AIOnboardingContext,
  conversation: OnboardingTurn[],
) {
  return allowedNumerals([
    JSON.stringify(context),
    ...conversation.filter((turn) => turn.role === "user").map((turn) => turn.content),
  ]);
}
