import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_TODAY, goldenWorkspace } from "../fixtures/golden-workspace";
import { toModel } from "../lib/model/convert";
import {
  intakeComplete,
  intakeProgress,
  isPlannable,
  nextStep,
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
