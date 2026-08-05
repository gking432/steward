import assert from "node:assert/strict";
import test from "node:test";
import { FIXTURE_TODAY, goldenScenario } from "../fixtures/golden-scenario";
import { goldenWorkspace } from "../fixtures/golden-workspace";
import { toLegacy, toModel } from "../lib/model/convert";
import {
  buildPaydayProposal,
  confirmProposal,
  isCycleConfirmed,
  supersedeStaleProposals,
} from "../lib/model/decide";
import { planCycle } from "../lib/model/engine";
import type { Workspace } from "../lib/model/types";

/**
 * PHASE 6 GATE.
 *
 * The rule under test is amendment A1: Steward may calculate and display a
 * payday plan automatically, and reserves may behave automatically, but
 * discretionary allocation across claims never happens without an explicit
 * confirmation. Inaction must move nothing.
 */

const ws = () => goldenScenario();

/**
 * A workspace with no synthetic claims.
 *
 * `goldenScenario` adds an Apartment pool claim to exercise ranking; it has no
 * legacy representation, so it is correctly dropped by a save/reload. Tests
 * that assert on persistence must start from something fully persistable.
 */
const persistable = () => toModel(goldenWorkspace());
const funded = (workspace: Workspace) =>
  Object.fromEntries(workspace.claims.map((claim) => [claim.name, claim.fundedAmount]));

test("a proposal is built automatically and reports the full waterfall", () => {
  const proposal = buildPaydayProposal(ws(), FIXTURE_TODAY)!;
  assert.equal(proposal.income, 2150);
  assert.equal(proposal.reservesTotal, 1388);
  assert.equal(proposal.spendTotal, 322);
  assert.equal(proposal.freeCapacity, 440);
  assert.ok(proposal.lines.length > 0);
  assert.equal(proposal.confirmed, false);
});

test("every reserve line explains itself, including the split", () => {
  const proposal = buildPaydayProposal(ws(), FIXTURE_TODAY)!;
  const rent = proposal.reserves.find((entry) => entry.name === "Rent")!;
  assert.equal(rent.amount, 800);
  assert.match(rent.note, /split over 2 paychecks/);
});

test("building a proposal changes no funding whatsoever", () => {
  const before = ws();
  const snapshot = funded(before);
  buildPaydayProposal(before, FIXTURE_TODAY);
  assert.deepEqual(funded(before), snapshot);
});

test("an ignored proposal is never applied — the core rule", () => {
  const before = persistable();
  const snapshot = funded(before);
  const proposal = buildPaydayProposal(before, FIXTURE_TODAY)!;

  // Simulate the user walking away: the proposal exists, nothing is confirmed.
  const afterIgnoring = toModel(toLegacy(before));
  assert.deepEqual(funded(afterIgnoring), snapshot);
  assert.equal(isCycleConfirmed(afterIgnoring, proposal.cycleId), false);
  assert.equal(afterIgnoring.allocations.length, 0);
});

test("confirming is the only thing that moves money", () => {
  const before = persistable();
  const proposal = buildPaydayProposal(before, FIXTURE_TODAY)!;
  const after = confirmProposal(before, proposal, "2026-08-10T12:00:00.000Z");

  assert.equal(isCycleConfirmed(after, proposal.cycleId), true);
  assert.equal(after.allocations.length, proposal.lines.length);

  const cushionBefore = before.claims.find((c) => c.name === "Cushion")!.fundedAmount;
  const cushionLine = proposal.lines.find((line) => line.claim.name === "Cushion");
  if (cushionLine) {
    const persisted = toModel(toLegacy(after));
    assert.equal(
      persisted.claims.find((c) => c.name === "Cushion")!.fundedAmount,
      Math.round((cushionBefore + cushionLine.amount) * 100) / 100,
    );
  }
});

test("confirmed allocations survive a save and reload", () => {
  const proposal = buildPaydayProposal(persistable(), FIXTURE_TODAY)!;
  const confirmed = confirmProposal(persistable(), proposal, "2026-08-10T12:00:00.000Z");
  const reloaded = toModel(toLegacy(confirmed));
  assert.equal(reloaded.allocations.length, proposal.lines.length);
  assert.ok(reloaded.allocations.every((row) => row.status === "confirmed"));
});

test("a confirmed allocation to a connected debt survives reload", () => {
  const before = persistable();
  const proposal = buildPaydayProposal(before, FIXTURE_TODAY)!;
  const debtLine = proposal.lines.find((line) => line.claim.kind === "payoff")!;
  assert.ok(debtLine.amount > 0, "fixture directs part of the paycheck to debt");

  const confirmed = confirmProposal(before, proposal, "2026-08-10T12:00:00.000Z");
  const reloaded = toModel(toLegacy(confirmed));
  assert.equal(
    reloaded.claims.find((claim) => claim.id === debtLine.claim.id)!.fundedAmount,
    debtLine.amount,
  );
});

test("confirming twice does not double-fund the same cycle", () => {
  const proposal = buildPaydayProposal(persistable(), FIXTURE_TODAY)!;
  const once = confirmProposal(persistable(), proposal, "2026-08-10T12:00:00.000Z");
  const twice = confirmProposal(once, proposal, "2026-08-10T12:00:00.000Z");
  assert.equal(twice.allocations.length, once.allocations.length);
  assert.deepEqual(funded(toModel(toLegacy(twice))), funded(toModel(toLegacy(once))));
});

test("a stale proposal is superseded, not quietly applied later", () => {
  const proposal = buildPaydayProposal(persistable(), FIXTURE_TODAY)!;
  const withPending: Workspace = {
    ...persistable(),
    allocations: proposal.lines.map((line, index) => ({
      id: `pending-${index}`,
      cycleId: proposal.cycleId,
      targetType: "claim" as const,
      targetId: line.claim.id,
      amount: line.amount,
      status: "proposed" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
    })),
  };

  // Pending rows contribute nothing to funding.
  assert.deepEqual(funded(toModel(toLegacy(withPending))), funded(persistable()));

  // A later cycle discards them.
  const superseded = supersedeStaleProposals(withPending, "cycle:2026-08-24");
  assert.equal(superseded.allocations.length, 0);
});

test("confirming preserves earlier cycles' confirmations", () => {
  const earlier: Workspace = {
    ...ws(),
    allocations: [
      {
        id: "old",
        cycleId: "cycle:2026-07-27",
        targetType: "claim",
        targetId: "claim:fx-goal-cushion",
        amount: 50,
        status: "confirmed",
        createdAt: "2026-07-27T00:00:00.000Z",
      },
    ],
  };
  const proposal = buildPaydayProposal(earlier, FIXTURE_TODAY)!;
  const after = confirmProposal(earlier, proposal);
  assert.ok(after.allocations.some((row) => row.cycleId === "cycle:2026-07-27"));
});

test("reserves are unaffected by whether the user confirms", () => {
  const before = ws();
  const proposal = buildPaydayProposal(before, FIXTURE_TODAY)!;
  const after = confirmProposal(before, proposal);
  // Obligations are automatic either way; only discretionary money waits.
  assert.equal(planCycle(before, FIXTURE_TODAY)!.reservesTotal, 1388);
  assert.equal(planCycle(after, FIXTURE_TODAY)!.reservesTotal, 1388);
});

test("no proposal is offered when there is nothing to direct", () => {
  const broke = ws();
  broke.profile.takeHomePay = 900;
  const proposal = buildPaydayProposal(broke, FIXTURE_TODAY)!;
  assert.equal(proposal.freeCapacity, 0);
  assert.equal(proposal.lines.length, 0);
});
