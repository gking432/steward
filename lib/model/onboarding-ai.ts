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
import { recurringReserve } from "./recurring-reserves";
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

/** Parse a cadence choice without depending on a model-authored phase. */
export function checkInCadenceFromAnswer(answer: string): CheckInCadence | null {
  if (/every[\s-]*other[\s-]*day/i.test(answer)) return "every_other_day";
  if (/\bdaily\b/i.test(answer)) return "daily";
  if (/\bweekly\b/i.test(answer)) return "weekly";
  return null;
}

/** A cadence answer closes onboarding when it follows the cadence question. */
export function checkInCadenceAnswerCompletes(answer: string, priorAssistant: string) {
  return checkInCadenceFromAnswer(answer) !== null &&
    /\b(check.?in|how often|rhythm)\b|\bweekly\b.{0,80}\bdaily\b|\bdaily\b.{0,80}\bweekly\b/i.test(priorAssistant);
}

export type SpendingReview = {
  id: string;
  normal: boolean;
  allocationPerPaycheck: number | null;
};

export type AIOnboardingState = {
  goals: OnboardingGoal[];
  goalCollectionComplete: boolean;
  prioritiesConfirmed: boolean;
  incomeConfirmed: boolean | null;
  spendingReviews: SpendingReview[];
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
  spendingReviews: [],
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
  const value = reply.trim();
  return /^(yes|no|accept|decline)\b/i.test(value) ||
    /^use\s+\$?\d/i.test(value) ||
    /^(?:use|choose) another amount$/i.test(value);
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
    id: string;
    category: string;
    amount: number;
    suggestedPerPaycheck: number;
    merchants: string[];
  }[];
  recurringCharges: {
    id: string;
    merchant: string;
    amount: number;
    cadence: string;
    yearlyCost: number;
    perPaycheck: number;
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

/**
 * Merchant choices can be submitted together, but Steward reviews them one at
 * a time. Derive the queue from the transcript so it stays grounded in exactly
 * what the user selected and requires no model-authored bookkeeping.
 */
export function recurringReviewProgress(
  context: AIOnboardingContext,
  conversation: OnboardingTurn[],
) {
  const flaggedIds = new Set<string>();
  const reviewedIds = new Set<string>();
  for (let index = 0; index < conversation.length; index += 1) {
    const turn = conversation[index];
    if (turn.role !== "assistant") continue;
    const answer = conversation[index + 1];
    if (!answer || answer.role !== "user") continue;
    if (/which one looks unfamiliar/i.test(turn.content)) {
      for (const charge of context.recurringCharges) {
        if (answer.content.toLowerCase().includes(charge.merchant.toLowerCase())) flaggedIds.add(charge.id);
      }
    }
    if (/do you still use/i.test(turn.content)) {
      for (const charge of context.recurringCharges) {
        if (turn.content.toLowerCase().includes(charge.merchant.toLowerCase())) reviewedIds.add(charge.id);
      }
    }
  }
  const flagged = context.recurringCharges.filter((charge) => flaggedIds.has(charge.id));
  const reviewed = context.recurringCharges.filter((charge) => reviewedIds.has(charge.id));
  return {
    flagged,
    reviewed,
    pending: flagged.filter((charge) => !reviewedIds.has(charge.id)),
  };
}

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

/**
 * Monthly bills have to fit inside an ordinary month, not an annualized
 * average. A biweekly worker usually has two checks in a month; the two
 * three-check months should create surplus instead of covering a silent
 * shortfall in the other ten months.
 */
function paychecksPerNormalMonth(workspace: Workspace) {
  return workspace.profile.payFrequency === "Weekly"
    ? 4
    : workspace.profile.payFrequency === "Monthly"
      ? 1
      : 2;
}

function annualCostPerNormalPaycheck(workspace: Workspace, yearly: number) {
  return round2(yearly / 12 / paychecksPerNormalMonth(workspace));
}

function contextCategories(workspace: Workspace, today: string) {
  return spendingByCategory(workspace, today)
    .slice(0, 10)
    .map((entry) => ({
      id: `spending:${slug(entry.category)}`,
      category: entry.category,
      amount: round2(entry.total / 3),
      suggestedPerPaycheck: round2((entry.total / 3) / paychecksPerNormalMonth(workspace)),
      merchants: entry.merchants.slice(0, 3),
    }));
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
      freesPerPaycheck: annualCostPerNormalPaycheck(workspace, yearly),
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
      .filter((bucket) => bucket.kind === "spend" || bucket.merchantKey)
      .flatMap((bucket) => [bucket.name.toLowerCase(), bucket.category?.toLowerCase() ?? ""]),
  );
  const additions = subscriptions(workspace, today)
    .filter((stream) => !cancelledIds.has(`cancel:${stream.key}`))
    .filter(
      (stream) =>
        !existingNames.has(stream.merchant.toLowerCase()) &&
        !existingNames.has(stream.category.toLowerCase()),
    )
    .map((stream) => recurringReserve({
      id: `bucket:onboarding:${slug(stream.key)}`,
      kind: "spend" as const,
      name: stream.merchant,
      merchantKey: stream.merchant.toLowerCase().replace(/[^a-z0-9]/g, ""),
      category: stream.category,
      essential: false,
      source: "derived" as const,
      perCycle: annualCostPerNormalPaycheck(workspace, annualCost(stream)),
      rollover: "sweep" as const,
    }, stream, today));
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
    monthlySpending: contextCategories(workspace, today),
    recurringCharges: recurring.map((stream) => ({
      id: stream.key,
      merchant: stream.merchant,
      amount: stream.typicalAmount,
      cadence: stream.cadence,
      yearlyCost: annualCost(stream),
      perPaycheck: annualCostPerNormalPaycheck(workspace, annualCost(stream)),
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

function answerChoices(content: string) {
  const selected = content.match(/^\s*Selected:\s*(.*?)(?:\.\s*More context:|\.?\s*$)/i);
  if (!selected) return [clean(content)];
  const choices = selected[1]
    .split(/\s*,\s*/)
    .map((choice) => clean(choice.replace(/[.!?]+$/, "")))
    .filter(Boolean);
  const moreContext = content.match(/\.\s*More context:\s*(.+)$/i)?.[1];
  if (moreContext && choices.some((choice) => /^something else$/i.test(choice))) {
    return [
      ...choices.filter((choice) => !/^something else$/i.test(choice)),
      clean(moreContext.replace(/[.!?]+$/, "")),
    ].filter(Boolean);
  }
  return choices;
}

/**
 * The AI can phrase the next question, but a button the user explicitly sent
 * must never disappear if that model turn times out or is rejected. Recover
 * purchase goals from the question/answer pair so the deterministic fallback
 * advances instead of returning to the first screen.
 */
function inferredGoalsFromAnswer(
  priorAssistant: string,
  lastUser: string,
  context: AIOnboardingContext,
): OnboardingGoal[] {
  const choices = answerChoices(lastUser);
  const broadGoalQuestion = /what would you like steward to help|what else are you trying|anything else your money|what should your money help/i.test(priorAssistant);
  const purchaseQuestion = /what would you like to buy|what are you planning to buy/i.test(priorAssistant);
  const savingsQuestion = /what (?:should the savings be|are you saving) for/i.test(priorAssistant);
  const debtQuestion = /which debts? should steward include|which debts? should we focus/i.test(priorAssistant);
  const breathingRoomQuestion = /where would (?:extra )?breathing room help/i.test(priorAssistant);
  if (broadGoalQuestion) {
    return choices.flatMap((choice, index) => {
      const match = [
        { pattern: /^pay off debt$/i, name: "Pay off debt", kind: "payoff" as const },
        { pattern: /^(?:buy something|another purchase)$/i, name: "Buy something", kind: "purchase" as const },
        { pattern: /^build savings$/i, name: "Build savings", kind: "fund" as const },
        { pattern: /^more breathing room$/i, name: "More breathing room", kind: "commitment" as const },
      ].find((entry) => entry.pattern.test(choice));
      if (!match) return [];
      return [{
        id: `goal:${slug(match.name)}:${index}`,
        name: match.name,
        kind: match.kind,
        targetAmount: null,
        targetDate: null,
        linkedAccountId: null,
        detailsComplete: false,
      }];
    });
  }
  if (debtQuestion) {
    return context.accounts.flatMap((account, index) => {
      if (!/credit|loan/i.test(account.type)) return [];
      const selected = choices.some((choice) => choice.toLowerCase().includes(account.name.toLowerCase()));
      if (!selected) return [];
      return {
        id: `goal:${account.id}:${index}`,
        name: `Pay off ${account.name}`,
        kind: "payoff" as const,
        targetAmount: null,
        targetDate: null,
        linkedAccountId: account.id,
        detailsComplete: true,
      };
    });
  }
  if (breathingRoomQuestion) {
    return choices
      .filter((answer) => answer && !/^(something else|other)$/i.test(answer))
      .slice(0, 2)
      .map((answer, index) => ({
        id: `goal:breathing-room:${slug(answer)}:${index}`,
        name: `More room for ${clean(answer).toLowerCase()}`,
        kind: "commitment" as const,
        targetAmount: null,
        targetDate: null,
        linkedAccountId: null,
        detailsComplete: true,
      }));
  }
  if (!purchaseQuestion && !savingsQuestion) return [];
  return choices
    .filter((answer) => answer && !/^(something else|other purchase|buy something|purchase)$/i.test(answer))
    .slice(0, 4)
    .map((answer, index) => {
      const stripped = clean(answer.replace(/^(?:a|an|the)\s+/i, ""));
      const name = stripped.charAt(0).toUpperCase() + stripped.slice(1);
      return {
        id: `goal:${slug(name)}:${index}`,
        name,
        kind: savingsQuestion ? "fund" as const : "purchase" as const,
        targetAmount: null,
        targetDate: null,
        linkedAccountId: null,
        // A concrete destination is enough for an initial plan. Steward can
        // refine price and timing later instead of turning onboarding into a
        // budgeting questionnaire.
        detailsComplete: !isVagueGoalName(name),
      };
    });
}

function goalIdentity(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const goal = value as Partial<OnboardingGoal>;
  return clean(goal.name).replace(/^(?:a|an|the)\s+/i, "").toLowerCase();
}

/**
 * These labels describe a direction, not an understood goal. They need one
 * human follow-up about what the person actually means—not an automatic price
 * question.
 */
function isVagueGoalName(name: string) {
  return /^(?:(?:buy )?(?:a )?(?:bunch of )?(?:stuff|things)|something|some stuff|some things|purchase|buy something|save money|savings|more breathing room|breathing room)$/i.test(name.trim());
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
  const explicitPriorityOrder = /^\s*priority order:/i.test(lastUser);
  const askedForAmount = /\b(amount|cost|how much|roughly)\b/i.test(priorAssistant);
  const enteredAmountMatch = lastUser.match(/(?:\$\s*)?([\d,]+(?:\.\d{1,2})?)\s*(k|thousand)?\b/i);
  const enteredAmount = enteredAmountMatch
    ? round2(Number(enteredAmountMatch[1].replace(/,/g, "")) * (enteredAmountMatch[2] ? 1000 : 1))
    : null;

  const inferredGoals = inferredGoalsFromAnswer(priorAssistant, lastUser, context);
  const rawCandidateGoals = explicitPriorityOrder
    ? previous.goals
    : Array.isArray(candidate.goals) && candidate.goals.length > 0
    ? candidate.goals
    : previous.goals;
  const broadGoal = /^(buy something|purchase|pay off debt|debt|build savings|savings|save money|more breathing room|breathing room)$/i;
  // A broad multi-select can contain several goals that must be discussed one
  // at a time. Preserve any still-unresolved selection even if the model only
  // returns the goal currently being discussed.
  const candidateGoals = rawCandidateGoals.concat(previous.goals.filter((goal) =>
    broadGoal.test(goal.name) &&
    !rawCandidateGoals.some((candidateGoal) => goalIdentity(candidateGoal) === goalIdentity(goal))));
  const inferredKinds = new Set(inferredGoals.map((goal) => goal.kind));
  const proposedGoals = candidateGoals
    .filter((goal) => {
      if (inferredGoals.length === 0 || !goal || typeof goal !== "object") return true;
      const name = clean((goal as Partial<OnboardingGoal>).name);
      if (/^(buy something|purchase)$/i.test(name) && inferredKinds.has("purchase")) return false;
      if (/^(pay off debt|debt)$/i.test(name) && inferredKinds.has("payoff")) return false;
      if (/^(build savings|savings|save money)$/i.test(name) && inferredKinds.has("fund")) return false;
      if (/^(more breathing room|breathing room)$/i.test(name) && inferredKinds.has("commitment")) return false;
      return true;
    })
    .concat(inferredGoals.filter((inferred) =>
      !candidateGoals.some((goal) => goalIdentity(goal) === goalIdentity(inferred))));
  const goals = proposedGoals.slice(0, 10).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const goal = raw as Partial<OnboardingGoal>;
    const name = clean(goal.name);
    if (!name || !kinds.has(goal.kind as OnboardingGoal["kind"])) return [];
    const modelTargetAmount =
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
    const amountBelongsToGoal = askedForAmount && enteredAmount !== null && enteredAmount > 0 &&
      previousGoal !== undefined && !previousGoal.detailsComplete &&
      (priorAssistant.includes(previousGoal.name.toLowerCase()) || previous.goals.filter((entry) => !entry.detailsComplete).length === 1);
    const targetAmount = modelTargetAmount ?? (amountBelongsToGoal ? enteredAmount : null);
    const genericGoal = /^(buy something|purchase|pay off debt|debt|build savings|savings|save money|more breathing room|breathing room)$/i.test(name);
    const vagueGoal = isVagueGoalName(name);
    const amountWasDeclined = /\b(not sure|don'?t know|no idea|unsure)\b/i.test(lastUser) && askedForAmount;
    const hasEnoughDetail = Boolean(previousGoal?.detailsComplete) ||
      (goal.kind === "payoff" ? linkedAccountId !== null : !genericGoal && !vagueGoal);
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
      detailsComplete: (Boolean(goal.detailsComplete) || amountWasDeclined || amountBelongsToGoal) && hasEnoughDetail,
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
    // Mentioning a merchant or category during statement review is not a
    // tradeoff proposal. Without this guard, "yes, that's normal" could be
    // misread as accepting a later cancellation or cut.
    if (!/\b(cancel|cut|reduce|bring|lower|free|save)\b/i.test(priorAssistant)) return false;
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
  const activeSpending = context.monthlySpending.find((entry) =>
    priorAssistant.includes(entry.category.toLowerCase()));
  const askedIfSpendingIsNormal = /\b(?:is|was) that\b.{0,28}\b(normal|usual|typical)\b|\b(normal|usual|typical)\b.{0,20}\bfor you\b/i.test(priorAssistant);
  const askedForSpendingAllocation = /\b(allocate|allocation|bucket|per paycheck|each paycheck)\b/i.test(priorAssistant);
  const unusualSpending = /\b(one.?time|unusual|not normal|not typical|rare|exception)\b/i.test(lastUser);
  const previousSpendingReviews = previous.spendingReviews.filter((review) =>
    context.monthlySpending.some((entry) => entry.id === review.id));
  const spendingReviewById = new Map(previousSpendingReviews.map((review) => [review.id, review]));
  if (activeSpending && askedIfSpendingIsNormal) {
    if (unusualSpending || (negative && !affirmative)) {
      spendingReviewById.set(activeSpending.id, {
        id: activeSpending.id,
        normal: false,
        allocationPerPaycheck: 0,
      });
    } else if (affirmative || /\b(normal|usual|typical)\b/i.test(lastUser)) {
      const existing = spendingReviewById.get(activeSpending.id);
      spendingReviewById.set(activeSpending.id, {
        id: activeSpending.id,
        normal: true,
        allocationPerPaycheck: existing?.allocationPerPaycheck ?? null,
      });
    }
  }
  if (activeSpending && askedForSpendingAllocation) {
    const useSuggested = affirmative || /\b(use|keep|works|that amount|looks good)\b/i.test(lastUser);
    const allocation = enteredAmount !== null && enteredAmount >= 0
      ? enteredAmount
      : useSuggested
        ? activeSpending.suggestedPerPaycheck
        : null;
    if (allocation !== null) {
      spendingReviewById.set(activeSpending.id, {
        id: activeSpending.id,
        normal: true,
        allocationPerPaycheck: allocation,
      });
    }
  }
  const spendingReviews = [...spendingReviewById.values()].filter((review) =>
    review.allocationPerPaycheck === null ||
    (review.allocationPerPaycheck >= 0 && Number.isFinite(review.allocationPerPaycheck)));
  const askedAboutRecurringSet =
    /\b(all of these|anything look surprising|keep them all|recurring charges)\b/i.test(priorAssistant);
  const recurringProgress = recurringReviewProgress(context, conversation);
  const finishedFlaggedReview = recurringProgress.flagged.length > 0 &&
    recurringProgress.pending.length === 0;
  const incomeConfirmed = previous.incomeConfirmed === true
    ? true
    : askedAboutIncome && affirmative && !negative
      ? true
      : askedAboutIncome && negative
        ? false
        : previous.incomeConfirmed;
  const recurringReviewed = context.recurringCharges.length === 0 || previous.recurringReviewed ||
    (askedAboutRecurringSet && affirmative && !negative) ||
    finishedFlaggedReview;
  const askedAboutBudget = /\b(budget|plan)\b/i.test(priorAssistant);
  const offeredCurrentBudget = /\b(?:current|existing)\b.{0,24}\bbudget\b|\b(?:do you )?want (?:to use )?this budget\b|\buse this budget\b/i.test(priorAssistant);
  const budgetAccepted = previous.budgetAccepted ||
    (askedAboutBudget && affirmative && !negative);
  const askedAboutCadence = /\b(check.?in|daily|weekly|every other day|how often)\b/i.test(priorAssistant);
  const checkInCadence: CheckInCadence | null = previous.checkInCadence ??
    (askedAboutCadence ? checkInCadenceFromAnswer(lastUser) : null);
  const keepCurrentSpending = /\b(keep|leave)\b.{0,24}\b(spending|budget|things|same|current)\b/i.test(lastUser);
  const reopenStrategy = askedAboutBudget && /\b(no|change|different|another|tradeoff)\b/i.test(lastUser);
  const strategyComplete = !reopenStrategy && (
    previous.strategyComplete ||
    accepted.length > 0 ||
    (offeredCurrentBudget && affirmative && !negative) ||
    (Boolean(candidate.strategyComplete) && keepCurrentSpending) ||
    (Boolean(candidate.strategyComplete) && context.strategies.length === 0)
  );

  const askedForAnotherGoal = /\b(another goal|anything else|add another|anything important|anything[^?.!]{0,24}missing)\b/i.test(priorAssistant);
  const finishedListingGoals = /\b(that['’]?s|that is) (everything|all)|\bno (more|other)|\bdone\b/i.test(lastUser) ||
    /^no\b/i.test(lastUser);
  const correctingGoal = /\b(i said|instead|not that|change|wrong)\b/i.test(lastUser) ||
    /^no\b/i.test(lastUser) && !finishedListingGoals;
  const goalCollectionComplete = !correctingGoal && (previous.goalCollectionComplete || explicitPriorityOrder || (
    goals.length > 0 &&
    goals.every((goal) => goal.detailsComplete) &&
    askedForAnotherGoal &&
    finishedListingGoals
  ));
  const askedAboutPriority = /\b(priority|priorities|first|most important|order)\b/i.test(priorAssistant);
  const goalSetChanged = goals.length !== previous.goals.length || goals.some((goal, index) =>
    previous.goals[index]?.id !== goal.id);
  const prioritiesConfirmed = goals.length < 2 || explicitPriorityOrder || (!goalSetChanged && previous.prioritiesConfirmed) ||
    (askedAboutPriority && lastUser.length > 0);

  const state: AIOnboardingState = {
    goals,
    goalCollectionComplete,
    prioritiesConfirmed,
    incomeConfirmed,
    spendingReviews,
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
    (state.incomeConfirmed === true &&
      state.spendingReviews.filter((review) => review.allocationPerPaycheck !== null).length >= context.monthlySpending.length &&
      state.recurringReviewed);
  state.complete = Boolean(
    context.scanComplete &&
    goalsReady &&
    financesReady &&
    state.strategyComplete &&
    state.budgetAccepted &&
    state.checkInCadence,
  );
  return state;
}

export type OnboardingPhase = "income" | "spending" | "recurring" | "goals" | "strategy" | "budget" | "checkin" | "complete";

export function onboardingPhase(
  state: AIOnboardingState,
  context: AIOnboardingContext,
): OnboardingPhase {
  if (!context.scanComplete || state.incomeConfirmed !== true) return "income";
  if (state.spendingReviews.filter((review) => review.allocationPerPaycheck !== null).length < context.monthlySpending.length) return "spending";
  if (!state.recurringReviewed) return "recurring";
  const goalsReady = state.goals.length > 0 && state.goalCollectionComplete &&
    state.prioritiesConfirmed && state.goals.every((goal) => goal.detailsComplete);
  if (!goalsReady) return "goals";
  if (!state.strategyComplete) return "strategy";
  if (!state.budgetAccepted) return "budget";
  if (!state.checkInCadence) return "checkin";
  return state.complete ? "complete" : "checkin";
}

/**
 * Spending the user calls unusual should not become a permanent category
 * target, but it also should not disappear from the plan. Steward collects
 * those observed amounts into one flexible bucket for irregular purchases.
 */
export function irregularSpendingPerPaycheck(
  context: AIOnboardingContext,
  state: AIOnboardingState,
) {
  const observed = state.spendingReviews.reduce((total, review) => {
    if (review.normal) return total;
    const category = context.monthlySpending.find((entry) => entry.id === review.id);
    return total + (category?.suggestedPerPaycheck ?? 0);
  }, 0);
  // Unusual history is accounted for without pretending it will all repeat.
  // Keep a modest flexible allowance, capped at 5% of take-home, and leave the
  // remainder available for the goals the user is about to set.
  return round2(Math.min(observed, context.paycheck.amount * 0.05));
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
  const reviewedAmounts = new Map(state.spendingReviews.flatMap((review) =>
    review.allocationPerPaycheck === null ? [] : [[review.id, review.allocationPerPaycheck] as const]));
  const reviewedCategories = contextCategories(workspace, today);
  const context = buildAIOnboardingContext(workspace, today, true);
  const recurringMerchants = new Set(
    context.recurringCharges.map((charge) => charge.merchant.toLowerCase()),
  );
  const representedByExistingPlan = new Set([
    "spending:housing",
    "spending:debt-payments",
    "spending:utilities",
  ]);
  for (const category of reviewedCategories) {
    if (category.merchants.length > 0 && category.merchants.every((merchant) =>
      recurringMerchants.has(merchant.toLowerCase()))) {
      representedByExistingPlan.add(category.id);
    }
  }
  const miscellaneousPerPaycheck = irregularSpendingPerPaycheck(context, state);
  const next: Workspace = {
    ...budgetWorkspace,
    buckets: budgetWorkspace.buckets.map((bucket) => {
      const cuts = selected.filter(
        (strategy) => strategy.kind === "cut_bucket" && strategy.targetId === bucket.id,
      );
      if (bucket.kind !== "spend") return bucket;
      const categoryId = `spending:${slug(bucket.category ?? bucket.name)}`;
      const reviewed = reviewedAmounts.get(categoryId);
      const cutAmount = cuts.length ? Math.min(...cuts.map((strategy) => strategy.toAmount)) : null;
      if (cutAmount !== null) return { ...bucket, perCycle: cutAmount };
      return reviewed === undefined || bucket.merchantKey ? bucket : { ...bucket, perCycle: reviewed };
    }),
  };

  if (miscellaneousPerPaycheck > 0) {
    const existingMiscellaneous = next.buckets.findIndex((bucket) =>
      bucket.kind === "spend" && slug(bucket.category ?? bucket.name) === "miscellaneous");
    if (existingMiscellaneous >= 0) {
      next.buckets[existingMiscellaneous] = {
        ...next.buckets[existingMiscellaneous],
        perCycle: miscellaneousPerPaycheck,
      } as Workspace["buckets"][number];
    } else {
      next.buckets.push({
        id: "bucket:onboarding:miscellaneous",
        kind: "spend",
        name: "Miscellaneous",
        category: "Miscellaneous",
        essential: false,
        source: "derived",
        perCycle: miscellaneousPerPaycheck,
        rollover: "roll",
      });
    }
  }

  const existingSpendIds = new Set(next.buckets.filter((bucket) => bucket.kind === "spend")
    .flatMap((bucket) => [`spending:${slug(bucket.category ?? bucket.name)}`, `spending:${slug(bucket.name)}`]));
  next.buckets = [
    ...next.buckets,
    ...state.spendingReviews.flatMap((review) => {
      if (
        review.allocationPerPaycheck === null ||
        review.allocationPerPaycheck <= 0 ||
        existingSpendIds.has(review.id) ||
        representedByExistingPlan.has(review.id)
      ) return [];
      const observed = reviewedCategories.find((entry) => entry.id === review.id);
      if (!observed) return [];
      return [{
        id: `bucket:onboarding:${slug(observed.category)}`,
        kind: "spend" as const,
        name: observed.category,
        category: observed.category,
        essential: false,
        source: "derived" as const,
        perCycle: review.allocationPerPaycheck,
        rollover: "sweep" as const,
      }];
    }),
  ];

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
      status: target > 0 || kind === "fund" ? "active" : "someday",
      openEnded: target === 0 && kind === "fund",
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
        status: prioritizedExisting.has(claim.id) ? "active" as const : claim.kind === "payoff" ? "someday" as const : claim.status,
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
  const context = buildAIOnboardingContext(workspace, today, true);
  const irregularCategories = new Set(state.spendingReviews.flatMap((review) => {
    if (review.normal) return [];
    const observed = context.monthlySpending.find((entry) => entry.id === review.id);
    return observed ? [observed.category] : [];
  }));
  const previewBase = previewAIOnboarding(workspace, today, state);
  const preview: Workspace = {
    ...previewBase,
    transactions: previewBase.transactions.map((transaction) =>
      transaction.type === "expense" && irregularCategories.has(transaction.category)
        ? { ...transaction, category: "Miscellaneous" }
        : transaction),
  };
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
