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

  /* --- phase 4: the plan --- */
  if (!answered(answers, "plan")) {
    return {
      id: "plan",
      phase: "plan",
      kind: "plan",
      prompt: "Here's what I've got for you.",
      choices: ["That works", "I want to change something"],
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
        "Your dashboard tracks spending as it happens. Your plan is the north star — it shows exactly how you get the things you asked for. Any time you want to move faster, ask me where to cut.",
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
  const picks = (goals?.picks ?? []).filter((pick) => pick !== "Not sure yet");

  const existing = workspace.claims.filter((claim) => claim.status === "active").length;
  const claims = picks.map((label, index) => {
    const spec = GOAL_KINDS[label] ?? { kind: "fund" as const, target: null };
    return {
      id: `claim:intake-${index}`,
      name: label,
      kind: spec.kind,
      targetAmount: spec.target ?? 0,
      fundedAmount: 0,
      rank: existing + index,
      status: (spec.target ? "active" : "someday") as "active" | "someday",
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
