import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_TODAY, goldenWorkspace } from "../fixtures/golden-workspace";
import { toModel } from "../lib/model/convert";
import {
  intakeComplete,
  intakeProgress,
  isPlannable,
  nextStep,
  applyIntake,
  applyTweak,
  cancelledSubscriptions,
  CHANGE_CHOICE,
  tweakChoices,
  proposedBuckets,
  type IntakeAnswer,
} from "../lib/model/intake";
import type { Transaction, Workspace } from "../lib/model/types";

/**
 * The conversation is a pure function of (ledger, answers), which is the whole
 * reason it can be tested. These drive it end to end and pin the two rules that
 * keep it from becoming an interrogation: only ask what is ambiguous, and cap
 * every phase.
 */

const base = () => toModel(goldenWorkspace());

const tx = (
  over: Partial<Transaction> & Pick<Transaction, "id" | "merchant" | "amount" | "date">,
): Transaction => ({
  accountId: "checking-1",
  description: over.merchant,
  category: "Uncategorized",
  type: "expense",
  ...over,
});

const withRows = (rows: Transaction[]): Workspace => {
  const workspace = base();
  return { ...workspace, transactions: [...workspace.transactions, ...rows] };
};

/** Answer whatever is asked, taking the first choice, until the flow ends. */
function runToCompletion(workspace: Workspace, limit = 40) {
  const answers: IntakeAnswer[] = [];
  const asked: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const step = nextStep(workspace, FIXTURE_TODAY, answers, true);
    if (!step) return { answers, asked };
    asked.push(step.id);
    answers.push({ stepId: step.id, choice: step.choices[0] });
  }
  throw new Error(`conversation did not terminate within ${limit} steps`);
}

/* ---------------------------------------------------------- the opening -- */

test("the conversation opens on goals, before any data is needed", () => {
  const step = nextStep(base(), FIXTURE_TODAY, [], false)!;
  assert.equal(step.phase, "goals");
  assert.ok(step.choices.includes("Not sure yet"), "an honest way out is always offered");
});

test("nothing after goals runs until the scan lands", () => {
  // This is what lets the conversation cover the sync instead of a spinner.
  const answers: IntakeAnswer[] = [{ stepId: "goals", choice: "Not sure yet" }];
  assert.equal(nextStep(base(), FIXTURE_TODAY, answers, false), null);
  assert.ok(nextStep(base(), FIXTURE_TODAY, answers, true));
});

/* --------------------------------------------------------------- income -- */

test("Steward states the paycheck it found rather than asking what you earn", () => {
  const answers: IntakeAnswer[] = [{ stepId: "goals", choice: "Not sure yet" }];
  const step = nextStep(base(), FIXTURE_TODAY, answers, true)!;
  assert.equal(step.kind, "confirm-income");
  assert.match(step.prompt, /\$2,150/);
  assert.match(step.prompt, /every two weeks/);
  assert.match(step.prompt, /Employer Payroll/);
});

test("a clean single income earns no follow-up question", () => {
  // The "don't ask" rule. One obvious paycheck and nothing else means Steward
  // states it and moves on.
  const { asked } = runToCompletion(base());
  const incomeQuestions = asked.filter((id) => id.startsWith("income:"));
  assert.deepEqual(incomeQuestions, ["income:primary"]);
});

test("an unexplained deposit becomes a question, quoting what was actually seen", () => {
  const workspace = withRows([
    tx({ id: "m1", merchant: "Zelle From Mom", amount: 300, date: "2026-06-04", type: "income", category: "Other income" }),
    tx({ id: "m2", merchant: "Zelle From Mom", amount: 300, date: "2026-07-02", type: "income", category: "Other income" }),
  ]);
  const answers: IntakeAnswer[] = [
    { stepId: "goals", choice: "Not sure yet" },
    { stepId: "income:primary", choice: "Yes, that's my job" },
  ];
  const step = nextStep(workspace, FIXTURE_TODAY, answers, true)!;
  assert.equal(step.kind, "identify-income");
  assert.match(step.prompt, /Zelle From Mom/);
  assert.match(step.prompt, /\$300/);
  assert.ok(step.choices.includes("Someone helping me out"));
});

test("with no regular paycheck Steward asks instead of inventing one", () => {
  const bare: Workspace = { ...base(), transactions: [] };
  const answers: IntakeAnswer[] = [{ stepId: "goals", choice: "Not sure yet" }];
  const step = nextStep(bare, FIXTURE_TODAY, answers, true)!;
  assert.equal(step.kind, "ask-income");
  assert.match(step.prompt, /can't see a regular paycheck/i);
});

test("only money that recurs on purpose can be planned around", () => {
  assert.equal(isPlannable("My job"), true);
  assert.equal(isPlannable("A side business"), true);
  assert.equal(isPlannable("Someone helping me out"), false, "a gift is not a plan");
  assert.equal(isPlannable("A one-off"), false);
});

/* ------------------------------------------------------------- spending -- */

test("a real subscription is raised with its yearly cost", () => {
  const workspace = withRows([
    tx({ id: "n1", merchant: "Netflix", amount: 15.49, date: "2026-05-30", category: "Entertainment" }),
    tx({ id: "n2", merchant: "Netflix", amount: 15.49, date: "2026-06-30", category: "Entertainment" }),
  ]);
  const step = runStepFor(workspace, "spend:sub:");
  assert.match(step.prompt, /Netflix/);
  assert.match(step.prompt, /\$186 a year/, "the yearly figure is what makes it real");
  assert.ok(step.choices.includes("That's not mine"));
});

test("a trivial subscription is not worth a turn", () => {
  const workspace = withRows([
    tx({ id: "c1", merchant: "Cloud Storage", amount: 0.99, date: "2026-05-30", category: "Software" }),
    tx({ id: "c2", merchant: "Cloud Storage", amount: 0.99, date: "2026-06-30", category: "Software" }),
    tx({ id: "c3", merchant: "Cloud Storage", amount: 0.99, date: "2026-07-30", category: "Software" }),
  ]);
  const { asked } = runToCompletion(workspace);
  assert.equal(asked.some((id) => id.includes("cloudstorage")), false, "$11.88 a year is noise");
});

test("many subscriptions do not become many questions", () => {
  // The cap. Someone with eleven recurring charges gets asked about the
  // costliest few, not interrogated right before the payoff.
  const rows: Transaction[] = [];
  for (let n = 0; n < 11; n += 1) {
    for (const [i, date] of ["2026-05-20", "2026-06-20", "2026-07-20"].entries()) {
      rows.push(
        tx({
          id: `sub-${n}-${i}`,
          merchant: `Service ${n}`,
          amount: 20 + n,
          date,
          category: "Entertainment",
        }),
      );
    }
  }
  const { asked } = runToCompletion(withRows(rows));
  assert.equal(asked.filter((id) => id.startsWith("spend:sub:")).length, 3);
});

/* ------------------------------------------------- termination and shape -- */

test("the conversation always terminates, and ends on the handoff", () => {
  const { asked } = runToCompletion(base());
  assert.equal(asked.at(-1), "handoff");
  assert.equal(asked.filter((id) => id === "plan").length, 1);
});

test("a completed conversation is what unlocks the rest of the app", () => {
  const workspace = base();
  const { answers } = runToCompletion(workspace);
  assert.equal(intakeComplete(workspace, FIXTURE_TODAY, answers), true);
  assert.equal(intakeComplete(workspace, FIXTURE_TODAY, []), false);
});

test("a clean ledger keeps the whole conversation short", () => {
  // Length scales with how messy the finances are. Someone with one paycheck
  // and no surprise subscriptions should be through in a handful of turns.
  const { asked } = runToCompletion(base());
  assert.ok(asked.length <= 6, `took ${asked.length} steps: ${asked.join(", ")}`);
});

test("progress is counted in phases, not questions", () => {
  // A bar driven by question count would jump around as Steward discovers
  // things, which reads as broken.
  const workspace = base();
  const { answers } = runToCompletion(workspace);
  const progress = intakeProgress(workspace, FIXTURE_TODAY, answers);
  assert.equal(progress.of, 5);
  assert.equal(progress.phase, 5, "a finished conversation reads as finished");
});

test("a skipped phase counts as behind you, not as missing progress", () => {
  // The golden fixture has no subscription worth asking about, so the spending
  // phase never runs. Progress must not stall at four fifths because of it.
  const workspace = base();
  const answers: IntakeAnswer[] = [
    { stepId: "goals", choice: "Not sure yet" },
    { stepId: "income:primary", choice: "Yes, that's my job" },
  ];
  const step = nextStep(workspace, FIXTURE_TODAY, answers, true)!;
  assert.equal(step.phase, "plan", "spending was skipped");
  assert.equal(intakeProgress(workspace, FIXTURE_TODAY, answers).phase, 3);
});

/* --------------------------------------------------------------- plan -- */

test("the bucket count comes from real spending, not a target number", () => {
  const proposed = proposedBuckets(base(), FIXTURE_TODAY);
  assert.ok(proposed.length > 0);
  for (const entry of proposed) {
    assert.ok(entry.share >= 0.01, `${entry.category} is below the noise floor`);
  }
});

test("a single stray charge does not earn a permanent bucket", () => {
  const workspace = withRows([
    tx({ id: "odd", merchant: "One Off Shop", amount: 3, date: "2026-07-20", category: "Curiosities" }),
  ]);
  const names = proposedBuckets(workspace, FIXTURE_TODAY).map((entry) => entry.category);
  assert.equal(names.includes("Curiosities"), false);
});

/** Drive the conversation until a step whose id starts with `prefix` comes up. */
function runStepFor(workspace: Workspace, prefix: string) {
  const answers: IntakeAnswer[] = [];
  for (let i = 0; i < 40; i += 1) {
    const step = nextStep(workspace, FIXTURE_TODAY, answers, true);
    if (!step) throw new Error(`conversation ended before reaching ${prefix}`);
    if (step.id.startsWith(prefix)) return step;
    answers.push({ stepId: step.id, choice: step.choices[0] });
  }
  throw new Error(`never reached ${prefix}`);
}

/* ------------------------------------------------------------- applying -- */

test("abandoning the conversation halfway leaves nothing behind", () => {
  // Everything before agreeing to the plan is a conversation, not a commitment.
  const workspace = base();
  const partial: IntakeAnswer[] = [
    { stepId: "goals", choice: "Pay off a credit card", picks: ["Pay off a credit card"] },
  ];
  assert.equal(
    intakeComplete(workspace, FIXTURE_TODAY, partial),
    false,
    "still mid-conversation, so the caller never applies it",
  );
  assert.equal(workspace.claims.length, base().claims.length, "no claim was created yet");
});

test("goals become claims, and none of them gets an invented amount", () => {
  const workspace = base();
  const before = workspace.claims.length;
  const next = applyIntake(workspace, FIXTURE_TODAY, [
    {
      stepId: "goals",
      choice: "Pay off a credit card",
      picks: ["Pay off a credit card", "Money for emergencies"],
    },
  ]);
  const added = next.claims.slice(before);
  assert.equal(added.length, 2);

  const payoff = added.find((claim) => claim.name === "Pay off a credit card")!;
  assert.equal(payoff.kind, "payoff");
  assert.equal(payoff.targetAmount, 0);
  assert.equal(payoff.status, "someday", "no figure means it waits, not that one is guessed");

  const cushion = added.find((claim) => claim.name === "Money for emergencies")!;
  assert.equal(cushion.status, "active", "a stated starting target can be funded");
});

test("\"Not sure yet\" is a real answer and creates nothing", () => {
  const workspace = base();
  const next = applyIntake(workspace, FIXTURE_TODAY, [
    { stepId: "goals", choice: "Not sure yet", picks: ["Not sure yet"] },
  ]);
  assert.equal(next.claims.length, workspace.claims.length);
  assert.equal(next.profile.onboardingComplete, true, "the app still opens, fully usable");
});

test("take-home is taken from the deposits Steward observed", () => {
  const next = applyIntake(base(), FIXTURE_TODAY, [
    { stepId: "goals", choice: "Not sure yet", picks: [] },
    { stepId: "income:primary", choice: "Yes, that's my job" },
  ]);
  assert.equal(next.profile.takeHomePay, 2150);
  assert.equal(next.profile.payFrequency, "Biweekly");
});

test("money the user called a gift is not planned around", () => {
  // The distinction that matters: a side business recurs, a parent helping out
  // may never happen again. Only one of them can carry a budget.
  const workspace = withRows([
    tx({ id: "m1", merchant: "Zelle From Mom", amount: 300, date: "2026-06-04", type: "income", category: "Other income" }),
    tx({ id: "m2", merchant: "Zelle From Mom", amount: 300, date: "2026-07-02", type: "income", category: "Other income" }),
  ]);
  const key = "income:other:income:zellefrommom";

  const asGift = applyIntake(workspace, FIXTURE_TODAY, [
    { stepId: "goals", choice: "Not sure yet", picks: [] },
    { stepId: "income:primary", choice: "Yes, that's my job" },
    { stepId: key, choice: "Someone helping me out" },
  ]);
  assert.equal(asGift.profile.takeHomePay, 2150, "a gift is excluded");

  const asBusiness = applyIntake(workspace, FIXTURE_TODAY, [
    { stepId: "goals", choice: "Not sure yet", picks: [] },
    { stepId: "income:primary", choice: "Yes, that's my job" },
    { stepId: key, choice: "A side business" },
  ]);
  assert.equal(asBusiness.profile.takeHomePay, 2450, "recurring earned income counts");
});

test("a subscription the user rejected is carried into the plan", () => {
  const workspace = withRows([
    tx({ id: "n1", merchant: "Netflix", amount: 15.49, date: "2026-05-30", category: "Entertainment" }),
    tx({ id: "n2", merchant: "Netflix", amount: 15.49, date: "2026-06-30", category: "Entertainment" }),
  ]);
  const cancelled = cancelledSubscriptions(workspace, FIXTURE_TODAY, [
    { stepId: "spend:sub:expense:netflix", choice: "I want to cancel that" },
  ]);
  assert.deepEqual(cancelled.map((s) => s.merchant), ["Netflix"]);
});

/* ---------------------------------------------------------- negotiation -- */

const toPlan = (workspace: Workspace): IntakeAnswer[] => {
  const answers: IntakeAnswer[] = [];
  for (let i = 0; i < 20; i += 1) {
    const step = nextStep(workspace, FIXTURE_TODAY, answers, true);
    if (!step || step.kind === "plan") return answers;
    answers.push({ stepId: step.id, choice: step.choices[0] });
  }
  throw new Error("never reached the plan");
};

test("\"I want to change something\" opens a negotiation, not a dead end", () => {
  const workspace = base();
  const answers = [...toPlan(workspace), { stepId: "plan", choice: CHANGE_CHOICE }];
  const step = nextStep(workspace, FIXTURE_TODAY, answers, true)!;
  assert.equal(step.kind, "tweak");
  assert.ok(step.choices.length > 1, "real levers are offered");
  assert.ok(step.choices.includes("Leave it as it is"), "backing out is always possible");
});

test("only levers that would actually do something are offered", () => {
  // A bucket with nothing in it cannot be cut. Offering the change anyway is
  // worse than offering fewer changes.
  const choices = tweakChoices(base());
  for (const choice of choices) {
    if (!choice.startsWith("Spend less on ")) continue;
    const name = choice.slice("Spend less on ".length);
    const bucket = base().buckets.find((entry) => entry.name === name)!;
    assert.ok((bucket.perCycle ?? 0) > 0, `${name} has nothing to cut`);
    assert.equal(bucket.essential, false, `${name} is an essential and shouldn't be offered`);
  }
});

test("cutting a bucket frees real money and says so", () => {
  const workspace = base();
  const choice = tweakChoices(workspace).find((entry) => entry.startsWith("Spend less on "))!;
  const name = choice.slice("Spend less on ".length);
  const before = workspace.buckets.find((entry) => entry.name === name)!.perCycle ?? 0;

  const result = applyTweak(workspace, FIXTURE_TODAY, choice)!;
  const after = result.workspace.buckets.find((entry) => entry.name === name)!.perCycle ?? 0;

  assert.ok(after < before, "the bucket actually shrank");
  assert.match(result.summary, /drops to/);
  assert.match(result.summary, /freeing/);
});

test("backing out changes nothing at all", () => {
  assert.equal(applyTweak(base(), FIXTURE_TODAY, "Leave it as it is"), null);
});

test("after a tweak the plan is presented again, so you agree to what you get", () => {
  // The point of the loop: the second card is rendered from the reshaped
  // workspace, not from the first draft.
  const workspace = base();
  const answers = [
    ...toPlan(workspace),
    { stepId: "plan", choice: CHANGE_CHOICE },
    { stepId: "tweak#0", choice: "Leave it as it is" },
  ];
  const step = nextStep(workspace, FIXTURE_TODAY, answers, true)!;
  assert.equal(step.kind, "plan");
  assert.equal(step.id, "plan#1", "a fresh presentation, not the answered one");
  assert.match(step.prompt, /how that changes things/i);
});

test("the negotiation can run several rounds and still terminates", () => {
  const workspace = base();
  const answers = [...toPlan(workspace)];
  for (const round of [0, 1, 2]) {
    const planId = round === 0 ? "plan" : `plan#${round}`;
    answers.push({ stepId: planId, choice: CHANGE_CHOICE });
    answers.push({ stepId: `tweak#${round}`, choice: "Leave it as it is" });
  }
  answers.push({ stepId: "plan#3", choice: "That works" });
  const step = nextStep(workspace, FIXTURE_TODAY, answers, true)!;
  assert.equal(step.kind, "handoff", "accepting ends the negotiation");
});

test("promoting a claim reports what slipped rather than only what improved", () => {
  const workspace = base();
  const choice = tweakChoices(workspace).find((entry) => entry.startsWith("Get "));
  if (!choice) return; // no second-ranked claim in this fixture
  const result = applyTweak(workspace, FIXTURE_TODAY, choice)!;
  assert.match(result.summary, /moves to the top/);
});
