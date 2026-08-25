/**
 * INTAKE — the onboarding conversation, as a state machine.
 *
 * Steward opens by asking what the user wants, then tells them what it noticed
 * about their money, then proposes a plan. This file decides what to say next.
 *
 * It is a pure function of (workspace, answers so far). No randomness, no
 * model. That is what makes a conversation testable: the same ledger and the
 * same answers always produce the same next question, so the flow can be driven
 * end to end in a test.
 *
 * The model's role, when a key is present, is narrow: reword `prompt` so it
 * doesn't read like a form, and map free text onto one of `choices`. It never
 * decides what to ask, and it never produces a figure. With no key the same
 * conversation runs on the choices alone.
 *
 * Two rules keep this from becoming an interrogation:
 *   - Steward only asks about what is genuinely ambiguous. One clean paycheck
 *     and nothing else is stated, not questioned.
 *   - Every phase is capped. Eleven subscriptions do not become eleven
 *     questions.
 */

import {
  annualCost,
  incomeObservations,
  spendingByCategory,
  subscriptions,
  type Stream,
} from "./observations";
import type { Workspace } from "./types";
import { formatMoney } from "./engine";
import {
  buildPaydayProposal,
  confirmProposal,
  promoteClaim,
  supersedeStaleProposals,
} from "./decide";

/** Most questions Steward will ask in one phase before moving on. */
const MAX_INCOME_QUESTIONS = 2;
const MAX_SUBSCRIPTION_QUESTIONS = 3;

/**
 * A subscription is only worth a question if it is big enough to matter over a
 * year. Below this Steward notes it in the plan rather than spending a turn.
 */
const SUBSCRIPTION_ANNUAL_FLOOR = 60;

export type IntakePhase = "goals" | "income" | "spending" | "plan" | "done";

export type IntakeStep =
  /** Phase 1. Runs while the bank scan is still in flight — needs no data. */
  | {
      id: string;
      phase: "goals";
      kind: "goals";
      prompt: string;
      choices: string[];
      multi: true;
    }
  /** Follow-up detail that turns a broad goal into an amount the engine can use. */
  | {
      id: string;
      phase: "goals";
      kind: "goal-detail";
      prompt: string;
      choices: string[];
      multi: false;
    }
  /** Phase 2a. Steward states the paycheck it found and checks it. */
  | {
      id: string;
      phase: "income";
      kind: "confirm-income";
      prompt: string;
      stream: Stream;
      choices: string[];
      multi: false;
    }
  /** Phase 2b. The deposits Steward cannot explain on its own. */
  | {
      id: string;
      phase: "income";
      kind: "identify-income";
      prompt: string;
      stream: Stream;
      choices: string[];
      multi: false;
    }
  /** Phase 2c. No schedule found at all, so Steward has to ask outright. */
  | {
      id: string;
      phase: "income";
      kind: "ask-income";
      prompt: string;
      choices: string[];
      multi: false;
    }
  /** Phase 3. Recurring charges worth a decision. */
  | {
      id: string;
      phase: "spending";
      kind: "subscription";
      prompt: string;
      stream: Stream;
      choices: string[];
      multi: false;
    }
  /** Phase 4. The proposal. Numbers come from the engine at render time. */
  | {
      id: string;
      phase: "plan";
      kind: "plan";
      prompt: string;
      choices: string[];
      multi: false;
    }
  /**
   * Phase 4b. "I want to change something" is a negotiation, not a dead end.
   * The options are built from the workspace, so Steward only offers changes
   * that would actually do something.
   */
  | {
      id: string;
      phase: "plan";
      kind: "tweak";
      prompt: string;
      choices: string[];
      multi: false;
    }
  /** Phase 5. The handoff to the rest of the app. */
  | {
      id: string;
      phase: "done";
      kind: "handoff";
      prompt: string;
      choices: string[];
      multi: false;
    };

export type IntakeAnswer = {
  stepId: string;
  /** The choice taken. Free text is mapped onto one of the step's `choices`. */
  choice: string;
  /** Multi-select phases record every pick. */
  picks?: string[];
  /** What the user actually typed, kept verbatim for later reference. */
  text?: string;
};

/* -------------------------------------------------------- negotiation -- */

export const CHANGE_CHOICE = "Show me another tradeoff";
export const KEEP_AS_IS = "Leave it as it is";
export const MAKE_ROOM = "Make room in flexible spending";

/** How many rounds of tweaking have been accepted so far. */
export const tweakRound = (answers: IntakeAnswer[]) =>
  answers.filter((answer) => answer.stepId.startsWith("tweak#")).length;

const wantsChange = (answers: IntakeAnswer[], planId: string) =>
  answers.some((answer) => answer.stepId === planId && answer.choice === CHANGE_CHOICE);

/** Prefix identifying a "spend less here" choice, and the bucket it names. */
export const CUT_PREFIX = "Spend less on ";
export const SOONER_PREFIX = "Get ";

/**
 * The changes worth offering, built from this workspace.
 *
 * Only real levers appear: a bucket with nothing in it cannot be cut, and a
 * claim already arriving this cycle cannot be brought forward. Offering a
 * change that does nothing is worse than offering fewer changes.
 */
export function tweakChoices(workspace: Workspace): string[] {
  const choices: string[] = [];

  const cuttable = workspace.buckets
    .filter((bucket) => bucket.kind === "spend" && !bucket.essential && (bucket.perCycle ?? 0) > 0)
    .sort((a, b) => (b.perCycle ?? 0) - (a.perCycle ?? 0))
    .slice(0, 2);
  for (const bucket of cuttable) choices.push(`${CUT_PREFIX}${bucket.name}`);

  const waiting = workspace.claims
    .filter((claim) => claim.status === "active")
    .sort((a, b) => a.rank - b.rank)
    .slice(1, 3);
  for (const claim of waiting) choices.push(`${SOONER_PREFIX}${claim.name} sooner`);

  choices.push(KEEP_AS_IS);
  return choices;
}

/* ------------------------------------------------------------- phase 1 -- */

/**
 * Deliberately ordinary, and deliberately including an honest way out. "Not
 * sure yet" is a real answer that must land the user in a working app — asking
 * someone to name a financial goal before they have seen anything is the
 * homework assignment this conversation exists to avoid.
 */
export const GOAL_CHOICES = [
  "Pay off a credit card",
  "Money for emergencies",
  "Get out of overdraft",
  "Save for something specific",
  "Stop living paycheck to paycheck",
  "Not sure yet",
];

const INCOME_SOURCE_CHOICES = [
  "My job",
  "A side business",
  "Someone helping me out",
  "A one-off",
];

/** Whether money from a source can be planned around in future cycles. */
export function isPlannable(choice: string) {
  return choice === "My job" || choice === "A side business";
}

/* -------------------------------------------------------------- driver -- */

const answered = (answers: IntakeAnswer[], id: string) =>
  answers.some((answer) => answer.stepId === id);

const cadenceWords = (stream: Stream) =>
  stream.cadence === "weekly"
    ? "every week"
    : stream.cadence === "biweekly"
      ? "every two weeks"
      : stream.cadence === "monthly"
        ? "every month"
        : "now and then";

const goalPicks = (answers: IntakeAnswer[]) =>
  (answers.find((answer) => answer.stepId === "goals")?.picks ?? [])
    .filter((pick) => pick !== "Not sure yet");

const answerChoice = (answers: IntakeAnswer[], stepId: string) =>
  answers.find((answer) => answer.stepId === stepId)?.choice;

const goalName = (choice: string, answers: IntakeAnswer[]) =>
  choice === "Save for something specific"
    ? (answerChoice(answers, "goal:specific:name") ?? choice)
    : choice;

const prioritizedGoal = (answers: IntakeAnswer[]) => {
  const picks = goalPicks(answers);
  return answerChoice(answers, "goal:priority") ?? (picks[0] ? goalName(picks[0], answers) : null);
};

/**
 * The next thing Steward should say, or `null` when the conversation is over.
 *
 * `scanComplete` gates every phase that needs transaction data. Until the sync
 * lands, only the goals phase can run — which is the point of asking about
 * goals first: the conversation covers the scan instead of a spinner.
 */
export function nextStep(
  workspace: Workspace,
  today: string,
  answers: IntakeAnswer[],
  scanComplete = true,
): IntakeStep | null {
  /* --- phase 1: what do you want --- */
  if (!answered(answers, "goals")) {
    return {
      id: "goals",
      phase: "goals",
      kind: "goals",
      prompt: "What made you download this? Pick anything that fits — you can change it later.",
      choices: GOAL_CHOICES,
      multi: true,
    };
  }

  const pickedGoals = goalPicks(answers);

  if (pickedGoals.includes("Save for something specific") && !answered(answers, "goal:specific:name")) {
    return {
      id: "goal:specific:name",
      phase: "goals",
      kind: "goal-detail",
      prompt: "What are you saving for?",
      choices: ["A trip", "A car", "A home", "Something else"],
      multi: false,
    };
  }

  if (pickedGoals.includes("Save for something specific") && !answered(answers, "goal:specific:amount")) {
    const name = answerChoice(answers, "goal:specific:name") ?? "it";
    return {
      id: "goal:specific:amount",
      phase: "goals",
      kind: "goal-detail",
      prompt: `About how much will ${name.toLowerCase()} cost?`,
      choices: ["$500", "$1,000", "$2,500", "$5,000 or more", "Not sure yet"],
      multi: false,
    };
  }

  if (pickedGoals.includes("Money for emergencies") && !answered(answers, "goal:emergency:amount")) {
    return {
      id: "goal:emergency:amount",
      phase: "goals",
      kind: "goal-detail",
      prompt: "How much of an emergency cushion would help you breathe easier?",
      choices: ["$1,000", "$2,000", "$5,000", "Not sure yet"],
      multi: false,
    };
  }

  if (pickedGoals.length > 1 && !answered(answers, "goal:priority")) {
    return {
      id: "goal:priority",
      phase: "goals",
      kind: "goal-detail",
      prompt: "If Steward can move one of these faster, which comes first?",
      choices: pickedGoals.map((choice) => goalName(choice, answers)),
      multi: false,
    };
  }

  const topGoal = prioritizedGoal(answers);
  if (topGoal && !answered(answers, "goal:pace")) {
    return {
      id: "goal:pace",
      phase: "goals",
      kind: "goal-detail",
      prompt: `How hard should Steward push on ${topGoal.toLowerCase()}?`,
      choices: ["Use whatever is left", MAKE_ROOM, "Keep it modest for now"],
      multi: false,
    };
  }

  // Everything below reads the ledger. If the scan has not landed there is
  // nothing truthful to say yet, so Steward waits rather than inventing.
  if (!scanComplete) return null;

  /* --- phase 2: income --- */
  const income = incomeObservations(workspace, today);

  if (income.primary) {
    if (!answered(answers, "income:primary")) {
      return {
        id: "income:primary",
        phase: "income",
        kind: "confirm-income",
        prompt: `I can see ${formatMoney(income.primary.typicalAmount)} coming in ${cadenceWords(income.primary)} from ${income.primary.merchant}. Is that your job?`,
        stream: income.primary,
        choices: ["Yes, that's my job", "No, something else"],
        multi: false,
      };
    }
  } else if (!answered(answers, "income:none")) {
    // No schedule found. Steward must not guess at a paycheck, so it asks.
    return {
      id: "income:none",
      phase: "income",
      kind: "ask-income",
      prompt:
        "I can't see a regular paycheck yet. How does money usually come in for you?",
      choices: [...INCOME_SOURCE_CHOICES, "It varies a lot"],
      multi: false,
    };
  }

  for (const stream of income.others.slice(0, MAX_INCOME_QUESTIONS)) {
    const id = `income:other:${stream.key}`;
    if (answered(answers, id)) continue;
    return {
      id,
      phase: "income",
      kind: "identify-income",
      prompt: `You also get ${formatMoney(stream.typicalAmount)} from ${stream.merchant} ${cadenceWords(stream)}. What's that?`,
      stream,
      choices: INCOME_SOURCE_CHOICES,
      multi: false,
    };
  }

  /* --- phase 3: spending --- */
  const worthAsking = subscriptions(workspace, today)
    .filter((stream) => annualCost(stream) >= SUBSCRIPTION_ANNUAL_FLOOR)
    .slice(0, MAX_SUBSCRIPTION_QUESTIONS);

  for (const stream of worthAsking) {
    const id = `spend:sub:${stream.key}`;
    if (answered(answers, id)) continue;
    return {
      id,
      phase: "spending",
      kind: "subscription",
      prompt: `${stream.merchant} is ${formatMoney(stream.typicalAmount)} ${cadenceWords(stream)} — ${formatMoney(annualCost(stream))} a year. Keeping it?`,
      stream,
      choices: ["Keep it", "I want to cancel that", "That's not mine"],
      multi: false,
    };
  }

  // If the user asked to move faster, negotiate the cost before presenting the
  // finished plan. A rejection advances to the next real lever; a yes changes
  // the draft and the plan card will show where that money went.
  if (answerChoice(answers, "goal:pace") === MAKE_ROOM) {
    const cuttable = workspace.buckets
      .filter((bucket) => bucket.kind === "spend" && !bucket.essential && (bucket.perCycle ?? 0) > 0)
      .sort((a, b) => (b.perCycle ?? 0) - (a.perCycle ?? 0))
      .slice(0, 2);
    const accepted = answers.some(
      (answer) => answer.stepId.startsWith("goal:tradeoff:") && answer.choice.startsWith(CUT_PREFIX),
    );
    if (!accepted) {
      for (const bucket of cuttable) {
        const id = `goal:tradeoff:${bucket.id}`;
        if (answered(answers, id)) continue;
        const current = bucket.perCycle ?? 0;
        const next = Math.max(0, current - Math.max(1, Math.round(current * 0.25)));
        return {
          id,
          phase: "plan",
          kind: "tweak",
          prompt: `To put more toward ${topGoal?.toLowerCase() ?? "that goal"}, I could bring ${bucket.name} from ${formatMoney(current)} to ${formatMoney(next)} a paycheck. Does that feel realistic?`,
          choices: [`${CUT_PREFIX}${bucket.name}`, "No — show me another option"],
          multi: false,
        };
      }
    }
  }

  /* --- phase 4: the plan, and the negotiation over it --- */
  //
  // Presenting the plan is not a one-shot. Each accepted tweak reshapes the
  // workspace and Steward shows the result again, so the user is agreeing to
  // the plan they actually end up with rather than to the first draft.
  const round = tweakRound(answers);
  const planId = round === 0 ? "plan" : `plan#${round}`;

  if (!answered(answers, planId)) {
    return {
      id: planId,
      phase: "plan",
      kind: "plan",
      prompt:
        round === 0
          ? `Here's the plan I built${topGoal ? ` around ${topGoal.toLowerCase()}` : " from your statements"}. Bills and minimums stay protected first, and every remaining dollar has a job.`
          : "Here's how that tradeoff changes the plan.",
      choices: ["Use this plan", CHANGE_CHOICE],
      multi: false,
    };
  }

  if (wantsChange(answers, planId)) {
    return {
      id: `tweak#${round}`,
      phase: "plan",
      kind: "tweak",
      prompt: "The cleanest levers are flexible spending and timing. Which tradeoff should I make?",
      choices: tweakChoices(workspace),
      multi: false,
    };
  }

  /* --- phase 5: handoff --- */
  if (!answered(answers, "handoff")) {
    return {
      id: "handoff",
      phase: "done",
      kind: "handoff",
      prompt:
        "Steward will keep this plan updated as money moves. You can always see where you stand, ask what is safe, or change what matters most.",
      choices: ["Got it"],
      multi: false,
    };
  }

  return null;
}

/** True once the conversation has run its course. Gates the rest of the app. */
export const intakeComplete = (
  workspace: Workspace,
  today: string,
  answers: IntakeAnswer[],
) => nextStep(workspace, today, answers, true) === null;

/**
 * How far along the conversation is, for a progress hint.
 *
 * Deliberately a phase count rather than a question count: the number of
 * questions depends on how messy the finances are, and a bar that jumps around
 * as Steward discovers things reads as broken.
 */
const PHASE_ORDER: IntakePhase[] = ["goals", "income", "spending", "plan", "done"];

export function intakeProgress(
  workspace: Workspace,
  today: string,
  answers: IntakeAnswer[],
) {
  const step = nextStep(workspace, today, answers, true);

  // Derived from where the conversation currently IS, not from how many
  // questions have been answered. A phase Steward had no reason to run — no
  // subscriptions worth asking about, say — is behind you, not missing: counting
  // answers instead reported a finished conversation as four fifths done.
  const phase = step ? PHASE_ORDER.indexOf(step.phase) : PHASE_ORDER.length;
  return { phase, of: PHASE_ORDER.length };
}

/** What a goal choice becomes once the user agrees to the plan. */
const GOAL_KINDS: Record<string, { kind: "payoff" | "fund" | "purchase"; target: number | null }> = {
  "Pay off a credit card": { kind: "payoff", target: null },
  "Money for emergencies": { kind: "fund", target: 1000 },
  "Get out of overdraft": { kind: "payoff", target: null },
  "Save for something specific": { kind: "purchase", target: null },
  "Stop living paycheck to paycheck": { kind: "fund", target: null },
};

const amountChoice = (answers: IntakeAnswer[], stepId: string, fallback: number | null) => {
  const choice = answerChoice(answers, stepId);
  if (!choice || choice === "Not sure yet") return fallback;
  const amount = Number(choice.replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
};

/**
 * Fold the conversation into the workspace.
 *
 * Applied only once the user agrees to the plan — everything before that is a
 * conversation, not a commitment, and abandoning it halfway must leave nothing
 * behind.
 *
 * No amount is ever invented. A goal the user named without a figure lands in
 * `someday` rather than being given a plausible target, because a target
 * Steward made up would then drive real allocations.
 */
export function applyIntake(
  workspace: Workspace,
  today: string,
  answers: IntakeAnswer[],
): Workspace {
  const goals = answers.find((answer) => answer.stepId === "goals");
  const rawPicks = (goals?.picks ?? []).filter((pick) => pick !== "Not sure yet");
  const priority = answerChoice(answers, "goal:priority");
  const picks = priority
    ? [...rawPicks].sort((a, b) => Number(goalName(b, answers) === priority) - Number(goalName(a, answers) === priority))
    : rawPicks;

  const existing = workspace.claims.filter((claim) => claim.status === "active").length;
  const claims = picks.map((label, index) => {
    const spec = GOAL_KINDS[label] ?? { kind: "fund" as const, target: null };
    const target =
      label === "Save for something specific"
        ? amountChoice(answers, "goal:specific:amount", spec.target)
        : label === "Money for emergencies"
          ? amountChoice(answers, "goal:emergency:amount", spec.target)
          : spec.target;
    return {
      id: `claim:intake-${index}`,
      name: goalName(label, answers),
      kind: spec.kind,
      targetAmount: target ?? 0,
      fundedAmount: 0,
      rank: existing + index,
      status: (target ? "active" : "someday") as "active" | "someday",
      horizon: "arrival" as const,
      divisible: spec.kind !== "purchase",
      delayCost: { type: "none" as const },
      protected: false,
    };
  });

  // Take-home comes from the deposits Steward actually observed, and only from
  // the ones the user confirmed are plannable. Money someone described as a
  // gift or a one-off is left out — planning around it would build a budget on
  // income that may never arrive again.
  const income = incomeObservations(workspace, today);
  const confirmedPrimary = answers.find(
    (answer) => answer.stepId === "income:primary" && answer.choice.startsWith("Yes"),
  );
  const plannableExtra = income.others
    .filter((stream) =>
      answers.some(
        (answer) => answer.stepId === `income:other:${stream.key}` && isPlannable(answer.choice),
      ),
    )
    .reduce((sum, stream) => sum + stream.typicalAmount, 0);

  const takeHome =
    confirmedPrimary && income.primary
      ? Math.round((income.primary.typicalAmount + plannableExtra) * 100) / 100
      : workspace.profile.takeHomePay;

  const payFrequency =
    confirmedPrimary && income.primary?.cadence === "weekly"
      ? "Weekly"
      : confirmedPrimary && income.primary?.cadence === "monthly"
        ? "Monthly"
        : confirmedPrimary && income.primary?.cadence === "biweekly"
          ? "Biweekly"
          : workspace.profile.payFrequency;

  return {
    ...workspace,
    profile: {
      ...workspace.profile,
      takeHomePay: takeHome,
      payFrequency,
      onboardingComplete: true,
    },
    claims: [...workspace.claims, ...claims],
  };
}

/**
 * Accept the plan the user just reviewed in first run.
 *
 * The intake plan and the first payday proposal describe the same paycheck.
 * Treating them as two separate approvals made Steward ask the user to approve
 * identical numbers twice. Acceptance now commits the current proposal in the
 * same transaction that completes onboarding.
 */
export function acceptIntake(
  workspace: Workspace,
  today: string,
  answers: IntakeAnswer[],
  now = new Date().toISOString(),
): Workspace {
  const accepted = applyIntake(workspace, today, answers);
  const proposal = buildPaydayProposal(accepted, today);
  if (!proposal || proposal.freeCapacity <= 0 || proposal.lines.length === 0) {
    return accepted;
  }
  return confirmProposal(
    supersedeStaleProposals(accepted, proposal.cycleId),
    proposal,
    now,
  );
}

/**
 * Carry out a tweak the user chose, returning the reshaped workspace and a
 * plain sentence describing what moved.
 *
 * The engine does the work — `accelerate` prices a cut, `promoteClaim` reorders
 * and reports what slipped. This only translates a choice into the right call,
 * and returns null when the choice changes nothing.
 */
export function applyTweak(
  workspace: Workspace,
  today: string,
  choice: string,
): { workspace: Workspace; summary: string } | null {
  if (choice === KEEP_AS_IS) return null;

  if (choice.startsWith(CUT_PREFIX)) {
    const name = choice.slice(CUT_PREFIX.length);
    const bucket = workspace.buckets.find(
      (entry) => entry.kind === "spend" && entry.name === name,
    );
    if (!bucket) return null;

    // A quarter off, rounded to whole dollars. Deliberately a starting
    // position rather than a maximum — the user can cut again, and Steward
    // re-presents the plan after each round.
    const current = bucket.perCycle ?? 0;
    const cut = Math.max(1, Math.round(current * 0.25));
    const next = Math.max(0, current - cut);

    return {
      workspace: {
        ...workspace,
        buckets: workspace.buckets.map((entry) =>
          entry.id === bucket.id ? { ...entry, perCycle: next } : entry,
        ),
      },
      summary: `${bucket.name} drops to ${formatMoney(next)} a paycheck, freeing ${formatMoney(cut)} for your priorities.`,
    };
  }

  if (choice.startsWith(SOONER_PREFIX)) {
    const name = choice.slice(SOONER_PREFIX.length).replace(/ sooner$/, "");
    const claim = workspace.claims.find((entry) => entry.name === name);
    if (!claim) return null;

    const promoted = promoteClaim(workspace, claim.id, today);
    if (!promoted) return null;

    const slipped = promoted.changes
      .filter((change) => change.direction === "later")
      .slice(0, 2)
      .map((change) => change.name);

    return {
      workspace: promoted.workspace,
      summary: slipped.length
        ? `${claim.name} moves to the top. ${slipped.join(" and ")} ${slipped.length > 1 ? "move" : "moves"} back.`
        : `${claim.name} moves to the top. Nothing else shifted.`,
    };
  }

  return null;
}

/** Subscriptions the user said they wanted to cancel, for the plan to reflect. */
export function cancelledSubscriptions(
  workspace: Workspace,
  today: string,
  answers: IntakeAnswer[],
): Stream[] {
  return subscriptions(workspace, today).filter((stream) =>
    answers.some(
      (answer) =>
        answer.stepId === `spend:sub:${stream.key}` && answer.choice === "I want to cancel that",
    ),
  );
}

/**
 * The categories Steward will propose as buckets.
 *
 * The count comes from the spending, not from a target. Categories below a
 * one-percent share are noise — a single stray charge should not earn a bucket
 * the user then has to manage forever.
 */
export function proposedBuckets(workspace: Workspace, today: string) {
  return spendingByCategory(workspace, today).filter((entry) => entry.share >= 0.01);
}
