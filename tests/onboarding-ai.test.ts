import assert from "node:assert/strict";
import test from "node:test";
import { demoWorkspace, FIXTURE_TODAY } from "../fixtures/golden-workspace";
import { toModel } from "../lib/model/convert";
import {
  EMPTY_AI_ONBOARDING_STATE,
  acceptAIOnboarding,
  buildAIOnboardingContext,
  normalizeAIOnboardingState,
  onboardingReplySubmitsImmediately,
  onboardingPhase,
  previewAIOnboarding,
  recurringReviewProgress,
  type AIOnboardingState,
} from "../lib/model/onboarding-ai";

const workspace = () => toModel(demoWorkspace());

test("binary replies submit immediately while selectable answers wait", () => {
  for (const reply of ["Yes", "No, something is off", "Accept", "Decline"]) {
    assert.equal(onboardingReplySubmitsImmediately(reply), true, reply);
  }
  for (const reply of ["Travel Rewards Card", "Vehicle", "I’m not sure yet"]) {
    assert.equal(onboardingReplySubmitsImmediately(reply), false, reply);
  }
});

test("every AI turn can receive a complete compact financial context", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  assert.equal(context.paycheck.amount, 2150);
  assert.match(context.paycheck.merchant ?? "", /Employer Payroll/);
  assert.ok(context.accounts.some((account) => account.type === "Credit card"));
  assert.ok(context.monthlySpending.some((entry) => entry.category === "Dining"));
  assert.ok(context.recurringCharges.some((entry) => entry.merchant === "Netflix"));
  assert.ok(context.strategies.some((entry) => entry.kind === "cut_bucket"));
  assert.ok(context.strategies.some((entry) => entry.kind === "cancel_subscription"));
});

test("free-form goals survive while invented amounts and strategies do not", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const validStrategy = context.strategies[0].id;
  const candidate: AIOnboardingState = {
    ...EMPTY_AI_ONBOARDING_STATE,
    goals: [
      {
        id: "goal:car",
        name: "Used car",
        kind: "purchase",
        targetAmount: 8000,
        targetDate: null,
        linkedAccountId: null,
        detailsComplete: true,
      },
      {
        id: "goal:clothes",
        name: "New clothes",
        kind: "purchase",
        targetAmount: 999,
        targetDate: null,
        linkedAccountId: null,
        detailsComplete: true,
      },
    ],
    goalCollectionComplete: true,
    prioritiesConfirmed: true,
    acceptedStrategyIds: [validStrategy, "invented:strategy"],
  };
  const normalized = normalizeAIOnboardingState(candidate, {
    ...EMPTY_AI_ONBOARDING_STATE,
    acceptedStrategyIds: [validStrategy],
  }, context, [
    { role: "user", content: "A used car for about $8,000 and some new clothes." },
  ]);
  assert.deepEqual(normalized.goals.map((goal) => goal.name), ["Used car", "New clothes"]);
  assert.equal(normalized.goals[0].targetAmount, 8000);
  assert.equal(normalized.goals[1].targetAmount, null, "the model cannot invent a clothes budget");
  assert.equal(normalized.goals[1].detailsComplete, false, "a missing amount needs its own follow-up");
  assert.equal(normalized.goalCollectionComplete, false, "the model cannot skip the explicit add-another-goal decision");
  assert.deepEqual(normalized.acceptedStrategyIds, [validStrategy]);
});

test("a sent purchase choice survives an empty model state", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const normalized = normalizeAIOnboardingState(
    { ...EMPTY_AI_ONBOARDING_STATE, goals: [] },
    EMPTY_AI_ONBOARDING_STATE,
    context,
    [
      { role: "assistant", content: "What would you like to buy?" },
      { role: "user", content: "Selected: A trip." },
    ],
  );
  assert.equal(normalized.goals.length, 1);
  assert.equal(normalized.goals[0].name, "Trip");
  assert.equal(normalized.goals[0].kind, "purchase");
  assert.equal(normalized.goals[0].detailsComplete, false);
  assert.equal(onboardingPhase(normalized, context), "goals");
});

test("several sent purchase choices are retained together", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const normalized = normalizeAIOnboardingState(
    EMPTY_AI_ONBOARDING_STATE,
    EMPTY_AI_ONBOARDING_STATE,
    context,
    [
      { role: "assistant", content: "What are you planning to buy?" },
      { role: "user", content: "Selected: A car, A trip." },
    ],
  );
  assert.deepEqual(normalized.goals.map((goal) => goal.name), ["Car", "Trip"]);
});

test("goal collection closes only after its own explicit one-piece question", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const goal = {
    id: "goal:car",
    name: "Used car",
    kind: "purchase" as const,
    targetAmount: 8000,
    targetDate: null,
    linkedAccountId: null,
    detailsComplete: true,
  };
  const previous: AIOnboardingState = {
    ...EMPTY_AI_ONBOARDING_STATE,
    goals: [goal],
  };
  const normalized = normalizeAIOnboardingState(
    { ...previous, goalCollectionComplete: true },
    previous,
    context,
    [
      { role: "assistant", content: "Would you like to add another goal?" },
      { role: "user", content: "No, continue." },
    ],
  );
  assert.equal(normalized.goalCollectionComplete, true);
});

test("declining to estimate a goal amount completes that detail without inventing money", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const candidate: AIOnboardingState = {
    ...EMPTY_AI_ONBOARDING_STATE,
    goals: [{
      id: "goal:emergency",
      name: "Emergency fund",
      kind: "fund",
      targetAmount: null,
      targetDate: null,
      linkedAccountId: null,
      detailsComplete: false,
    }],
  };
  const normalized = normalizeAIOnboardingState(
    candidate,
    EMPTY_AI_ONBOARDING_STATE,
    context,
    [
      { role: "assistant", content: "What rough amount would you like in your emergency fund?" },
      { role: "user", content: "Selected: I’m not sure yet." },
    ],
  );
  assert.equal(normalized.goals[0].detailsComplete, true);
  assert.equal(normalized.goals[0].targetAmount, null);
});

test("several flagged recurring charges are reviewed one at a time", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const [first, second] = context.recurringCharges;
  const oneAnswered = [
    { role: "assistant" as const, content: "Which one looks unfamiliar?" },
    { role: "user" as const, content: `Selected: ${first.merchant}, ${second.merchant}.` },
    { role: "assistant" as const, content: `Do you still use ${first.merchant}?` },
    { role: "user" as const, content: "Selected: No." },
  ];
  const progress = recurringReviewProgress(context, oneAnswered);
  assert.deepEqual(progress.pending.map((charge) => charge.id), [second.id]);

  const candidate = { ...EMPTY_AI_ONBOARDING_STATE, incomeConfirmed: true, recurringReviewed: true };
  const normalized = normalizeAIOnboardingState(
    candidate,
    { ...EMPTY_AI_ONBOARDING_STATE, incomeConfirmed: true },
    context,
    oneAnswered,
  );
  assert.equal(normalized.recurringReviewed, false, "one answered charge cannot close a two-charge review");

  const allAnswered = [
    ...oneAnswered,
    { role: "assistant" as const, content: `Do you still use ${second.merchant}?` },
    { role: "user" as const, content: "Selected: Yes." },
  ];
  const finished = normalizeAIOnboardingState(candidate, normalized, context, allAnswered);
  assert.equal(finished.recurringReviewed, true);
});

test("accepted strategies reshape the preview with exact engine-owned amounts", () => {
  const base = workspace();
  const context = buildAIOnboardingContext(base, FIXTURE_TODAY, true);
  const cut = context.strategies.find((entry) => entry.kind === "cut_bucket")!;
  const state: AIOnboardingState = {
    ...EMPTY_AI_ONBOARDING_STATE,
    goals: [{
      id: "goal:trip",
      name: "Japan trip",
      kind: "purchase",
      targetAmount: 2500,
      targetDate: null,
      linkedAccountId: null,
      detailsComplete: true,
    }],
    goalCollectionComplete: true,
    prioritiesConfirmed: true,
    acceptedStrategyIds: [cut.id],
  };
  const preview = previewAIOnboarding(base, FIXTURE_TODAY, state);
  assert.equal(preview.buckets.find((bucket) => bucket.id === cut.targetId)?.perCycle, cut.toAmount);
  assert.equal(preview.claims.find((claim) => claim.name === "Japan trip")?.targetAmount, 2500);
});

test("an explicit yes or no records the one strategy Steward just discussed", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const option = context.strategies.find((entry) => entry.kind === "cut_bucket")!;
  const accepted = normalizeAIOnboardingState(
    EMPTY_AI_ONBOARDING_STATE,
    EMPTY_AI_ONBOARDING_STATE,
    context,
    [
      { role: "assistant", content: `${option.label}. Does that work?` },
      { role: "user", content: "Yes, that works. Deal." },
    ],
  );
  assert.deepEqual(accepted.acceptedStrategyIds, [option.id]);
  assert.equal(accepted.strategyComplete, true);

  const declined = normalizeAIOnboardingState(
    EMPTY_AI_ONBOARDING_STATE,
    EMPTY_AI_ONBOARDING_STATE,
    context,
    [
      { role: "assistant", content: `${option.label}. Does that work?` },
      { role: "user", content: "No, show me another." },
    ],
  );
  assert.deepEqual(declined.declinedStrategyIds, [option.id]);
  assert.equal(declined.strategyComplete, false);

  const keptCurrent = normalizeAIOnboardingState(
    EMPTY_AI_ONBOARDING_STATE,
    EMPTY_AI_ONBOARDING_STATE,
    context,
    [
      { role: "assistant", content: `${option.label}. Does that work?` },
      { role: "user", content: "Keep the current Dining budget." },
    ],
  );
  assert.deepEqual(keptCurrent.acceptedStrategyIds, []);
  assert.deepEqual(keptCurrent.declinedStrategyIds, [option.id]);
});

test("wrapped Accept and Decline replies settle exactly the discussed strategy", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const option = context.strategies.find((entry) => entry.kind === "cut_bucket")!;
  const assistant = `${option.label}. Does that feel realistic?`;

  const accepted = normalizeAIOnboardingState(
    EMPTY_AI_ONBOARDING_STATE,
    EMPTY_AI_ONBOARDING_STATE,
    context,
    [
      { role: "assistant", content: assistant },
      { role: "user", content: "Selected: Accept." },
    ],
  );
  assert.deepEqual(accepted.acceptedStrategyIds, [option.id]);
  assert.equal(accepted.strategyComplete, true);

  const declined = normalizeAIOnboardingState(
    EMPTY_AI_ONBOARDING_STATE,
    EMPTY_AI_ONBOARDING_STATE,
    context,
    [
      { role: "assistant", content: assistant },
      { role: "user", content: "Selected: Decline." },
    ],
  );
  assert.deepEqual(declined.declinedStrategyIds, [option.id]);
  assert.equal(declined.strategyComplete, false);
});

test("a debt goal reuses the known debt instead of creating a duplicate", () => {
  const base = workspace();
  const card = base.accounts.find((account) => account.type === "Credit card")!;
  const before = base.claims.filter((claim) => claim.kind === "payoff").length;
  const preview = previewAIOnboarding(base, FIXTURE_TODAY, {
    ...EMPTY_AI_ONBOARDING_STATE,
    goals: [{
      id: "goal:card",
      name: "Pay off my card",
      kind: "payoff",
      targetAmount: null,
      targetDate: null,
      linkedAccountId: card.id,
      detailsComplete: true,
    }],
  });
  assert.equal(preview.claims.filter((claim) => claim.kind === "payoff").length, before);
  assert.equal(preview.claims.find((claim) => claim.linkedAccountId === card.id)?.status, "active");
});

test("one answer can select several detected debts", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const debts = context.accounts.filter((account) => /credit|loan/i.test(account.type));
  assert.ok(debts.length >= 2);
  const candidate: AIOnboardingState = {
    ...EMPTY_AI_ONBOARDING_STATE,
    goals: debts.slice(0, 2).map((account) => ({
      id: `goal:${account.id}`,
      name: `Pay off ${account.name}`,
      kind: "payoff",
      targetAmount: null,
      targetDate: null,
      linkedAccountId: account.id,
      detailsComplete: true,
    })),
  };
  const answer = debts.slice(0, 2).map((account) => account.name).join(" and ");
  const normalized = normalizeAIOnboardingState(candidate, EMPTY_AI_ONBOARDING_STATE, context, [
    { role: "assistant", content: "Which debts should Steward include? Choose one or more." },
    { role: "user", content: answer },
  ]);
  assert.deepEqual(
    normalized.goals.map((goal) => goal.linkedAccountId),
    debts.slice(0, 2).map((account) => account.id),
  );
});

test("a correction reopens goal selection instead of advancing", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const card = context.accounts.find((account) => /credit/i.test(account.type))!;
  const previous: AIOnboardingState = {
    ...EMPTY_AI_ONBOARDING_STATE,
    goals: [{
      id: "goal:card",
      name: `Pay off ${card.name}`,
      kind: "payoff",
      targetAmount: null,
      targetDate: null,
      linkedAccountId: card.id,
      detailsComplete: true,
    }],
    goalCollectionComplete: true,
    prioritiesConfirmed: true,
  };
  const normalized = normalizeAIOnboardingState(previous, previous, context, [
    { role: "assistant", content: "Would you like to add another goal?" },
    { role: "user", content: "No, I said credit card." },
  ]);
  assert.equal(normalized.goalCollectionComplete, false);
  assert.equal(onboardingPhase(normalized, context), "goals");
});

test("completion requires goals, financial review, strategy, budget approval, and cadence", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const almost: AIOnboardingState = {
    ...EMPTY_AI_ONBOARDING_STATE,
    goals: [{
      id: "goal:cushion",
      name: "Emergency cushion",
      kind: "fund",
      targetAmount: 2000,
      targetDate: null,
      linkedAccountId: null,
      detailsComplete: true,
    }],
    goalCollectionComplete: true,
    prioritiesConfirmed: true,
    incomeConfirmed: true,
    recurringReviewed: true,
    strategyComplete: true,
    budgetAccepted: true,
  };
  assert.equal(onboardingPhase(almost, context), "checkin");
  const complete = normalizeAIOnboardingState(
    { ...almost, checkInCadence: "every_other_day", complete: true },
    almost,
    context,
    [
      { role: "user", content: "I want a $2,000 cushion." },
      { role: "assistant", content: "How often should I check in: daily, every other day, or weekly?" },
      { role: "user", content: "Every other day works." },
    ],
  );
  assert.equal(complete.complete, true);
  assert.equal(onboardingPhase(complete, context), "complete");
});

test("the model cannot confirm finances before the user answers that question", () => {
  const context = buildAIOnboardingContext(workspace(), FIXTURE_TODAY, true);
  const candidate: AIOnboardingState = {
    ...EMPTY_AI_ONBOARDING_STATE,
    incomeConfirmed: true,
    recurringReviewed: true,
  };
  const premature = normalizeAIOnboardingState(candidate, EMPTY_AI_ONBOARDING_STATE, context, [
    { role: "assistant", content: "What are your goals?" },
    { role: "user", content: "Pay off my card." },
  ]);
  assert.equal(premature.incomeConfirmed, null);
  assert.equal(premature.recurringReviewed, false);

  const confirmed = normalizeAIOnboardingState(candidate, premature, context, [
    { role: "assistant", content: "I found your paycheck and recurring charges. Is the income right, and should those charges stay?" },
    { role: "user", content: "Yes, the paycheck is right. Keep them." },
  ]);
  assert.equal(confirmed.incomeConfirmed, true);
  assert.equal(confirmed.recurringReviewed, true);
});

test("accepted onboarding persists the check-in cadence", () => {
  const base = workspace();
  const accepted = acceptAIOnboarding(base, FIXTURE_TODAY, {
    ...EMPTY_AI_ONBOARDING_STATE,
    checkInCadence: "daily",
  });
  assert.equal(accepted.profile.onboardingComplete, true);
  assert.equal(accepted.legacy.notificationPreferences.dailyCheckIn, true);
  assert.equal(accepted.legacy.notificationPreferences.weeklyReview, false);
});
