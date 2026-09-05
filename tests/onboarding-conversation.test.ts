import test from "node:test";
import assert from "node:assert/strict";
import { demoWorkspace, FIXTURE_TODAY } from "../fixtures/golden-workspace";
import { toModel } from "../lib/model/convert";
import {
  openConversation,
  confirmPicture,
  openingFindings,
  receiveConversation,
  reviewConversation,
} from "../lib/model/onboarding-conversation";
import {
  approveSession,
  sessionWorkspace,
  sessionSchema,
} from "../lib/model/planning-session";
import {
  EMPTY_CHAT_DRAFT,
  validateChatDraft,
  workspaceFromChat,
} from "../lib/model/chat-plan";
import {
  billAmount,
  planCycle,
  projectArrivals,
  reserveRequirement,
} from "../lib/model/engine";
import { workspaceSchema } from "../lib/model/validation";
const base = () => toModel(demoWorkspace());
const start = () => openConversation(base(), FIXTURE_TODAY);
const goals = [
  {
    id: "cushion",
    name: "Cushion",
    kind: "fund" as const,
    amount: null,
    contribution: 100,
    date: null,
    accountId: null,
    evidence: "100 each payday",
  },
  {
    id: "camera",
    name: "Camera",
    kind: "purchase" as const,
    amount: 1200,
    contribution: null,
    date: null,
    accountId: null,
    evidence: "camera for 1200",
  },
];
test("opening findings derive from supplied account data without a form transition", () => {
  const s = start();
  s.base.profile.takeHomePay = 2311;
  s.base.buckets.find((b) => /rent/i.test(b.name))!.amountDue = 1633;
  assert.match(openingFindings(s, false), /2,311/);
  assert.match(openingFindings(s, false), /1,633/);
  const confirmed = confirmPicture(s);
  assert.equal(confirmed.stage, "priorities");
  assert.equal(confirmed.confirmed.length, 3);
  assert.deepEqual(confirmed.base, s.base);
});
test("exploration preserves two preferences without accepting invented allocations or fact edits", () => {
  const s = confirmPicture(start());
  const next = receiveConversation(
    s,
    {
      ...EMPTY_CHAT_DRAFT,
      responseKind: "explore",
      goals,
      bucketEdits: [
        { id: s.base.buckets[0].id, amount: 50, evidence: "invented" },
      ],
      income: 1,
      preferences: ["Security for surprise bills", "Keep going out"],
      readyToReview: true,
    },
    [{ role: "user", content: "I want a cushion but still want to go out" }],
    ["propose_update"],
  );
  assert.deepEqual(next.draft.goals, []);
  assert.deepEqual(next.draft.bucketEdits, []);
  assert.equal(next.draft.income, null);
  assert.equal(next.draft.preferences?.length, 2);
  assert.equal(next.draft.readyToReview, false);
  assert.equal(next.turns.length, 1);
  assert.throws(() => reviewConversation(next));
});
test("future rent starts with the first eligible bill and survives validation and projection", () => {
  const s = start(),
    rent = s.base.buckets.find((b) => /rent/i.test(b.name))!;
  const draft = {
    ...EMPTY_CHAT_DRAFT,
    goals,
    bucketEdits: [
      {
        id: rent.id,
        amount: 1750,
        effectiveDate: "2026-09-01",
        evidence: "rent goes up to 1750 next month",
      },
    ],
  };
  const next = workspaceFromChat(s.base, FIXTURE_TODAY, draft);
  const revised = next.buckets.find((b) => b.id === rent.id)!;
  assert.equal(revised.amountDue, 1600);
  assert.equal(billAmount(revised), 1600);
  assert.equal(billAmount({ ...revised, dueDate: "2026-09-28" }), 1750);
  assert.equal(
    planCycle(next, FIXTURE_TODAY)!.reservesTotal,
    planCycle(s.base, FIXTURE_TODAY)!.reservesTotal,
  );
  assert.ok(
    reserveRequirement(
      { ...revised, dueDate: "2026-09-28" },
      next,
      "2026-09-10",
    ).required >
      reserveRequirement(
        { ...revised, scheduledAmount: undefined, dueDate: "2026-09-28" },
        next,
        "2026-09-10",
      ).required,
  );
  assert.deepEqual(
    workspaceSchema
      .parse(JSON.parse(JSON.stringify(next)))
      .buckets.find((b) => b.id === rent.id)!.scheduledAmount,
    revised.scheduledAmount,
  );
  const unchanged = workspaceFromChat(s.base, FIXTURE_TODAY, {
    ...draft,
    bucketEdits: [],
  });
  const future = projectArrivals(next, FIXTURE_TODAY),
    old = projectArrivals(unchanged, FIXTURE_TODAY);
  assert.ok(
    future.find((d) => d.name === "Camera")!.arrivalDate! >=
      old.find((d) => d.name === "Camera")!.arrivalDate!,
  );
  assert.deepEqual(next.accounts, s.base.accounts);
});
test("ambiguous date does not change fact; invalid dates and timed spending are rejected", () => {
  const s = start();
  const d = {
    ...s.draft,
    responseKind: "clarify" as const,
    income: 900,
    questions: ["When does that start?"],
  };
  const next = receiveConversation(
    s,
    d,
    [{ role: "user", content: "rent changes soon" }],
    [],
  );
  assert.equal(next.draft.income, null);
  assert.deepEqual(next.base, s.base);
  const edit = {
    id: s.base.buckets.find((b) => b.kind === "spend")!.id,
    amount: 50,
    effectiveDate: "2026-09-01",
    evidence: "change",
  };
  assert.throws(() =>
    validateChatDraft({ ...EMPTY_CHAT_DRAFT, bucketEdits: [edit] }, s.base, [
      { role: "user", content: "change" },
    ]),
  );
  assert.throws(() =>
    validateChatDraft(
      {
        ...EMPTY_CHAT_DRAFT,
        bucketEdits: [{ ...edit, effectiveDate: "2026-02-30" }],
      },
      s.base,
      [{ role: "user", content: "change" }],
    ),
  );
});
test("multi-detail proposal and revision retain context and require fresh explicit approval", () => {
  const w = base(),
    s = confirmPicture(openConversation(w, FIXTURE_TODAY));
  const turns = [
    {
      role: "user" as const,
      content: "100 each payday and a camera for 1200; keep going out",
    },
  ];
  const d = {
    ...EMPTY_CHAT_DRAFT,
    goals,
    responseKind: "proposal" as const,
    preferences: ["Keep going out"],
    readyToReview: true,
    questions: [],
  };
  const p = receiveConversation(s, d, turns, ["propose_update"]);
  assert.equal(p.stage, "build");
  assert.equal(p.draft.goals.length, 2);
  assert.deepEqual(sessionWorkspace(p).buckets, s.base.buckets);
  let review = reviewConversation(p);
  assert.throws(() => approveSession(review, w, FIXTURE_TODAY));
  review = { ...review, assumptionsAccepted: true };
  const revised = receiveConversation(
    review,
    { ...d, goals: [{ ...goals[0], contribution: 50 }, goals[1]] },
    [...turns, { role: "user", content: "Actually 50 each payday" }],
    ["propose_update"],
  );
  assert.equal(revised.stage, "build");
  assert.equal(revised.assumptionsAccepted, false);
  assert.equal(revised.turns.length, 2);
  assert.throws(() => approveSession(revised, w, FIXTURE_TODAY));
  const restored = sessionSchema.parse(JSON.parse(JSON.stringify(revised)));
  assert.equal(restored.draft.preferences?.[0], "Keep going out");
  const approved = approveSession(
    { ...reviewConversation(revised), assumptionsAccepted: true },
    w,
    FIXTURE_TODAY,
  );
  assert.equal(approved.profile.onboardingComplete, true);
  assert.deepEqual(approved.accounts, w.accounts);
  assert.equal(
    approved.claims.find((c) => c.name === "Cushion")!.fundedAmount,
    50,
  );
});
