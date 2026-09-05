import test from "node:test";
import assert from "node:assert/strict";
import { demoWorkspace, FIXTURE_TODAY } from "../fixtures/golden-workspace";
import { toModel } from "../lib/model/convert";
import { openConversation } from "../lib/model/onboarding-conversation";
import { sessionWorkspace } from "../lib/model/planning-session";
import { demoFindings } from "../lib/model/demo-findings";
const fixture = () =>
  sessionWorkspace(openConversation(toModel(demoWorkspace()), FIXTURE_TODAY));
test("demo findings keep current cash, paycheck income and planned capacity separate", () => {
  const w = fixture(),
    f = demoFindings(w, FIXTURE_TODAY);
  assert.equal(f.cash, 1840);
  assert.equal(f.income, 2150);
  assert.equal(f.plan?.freeCapacity, 375.26);
  w.profile.takeHomePay = 2300;
  assert.equal(demoFindings(w, FIXTURE_TODAY).cash, f.cash);
  assert.equal(demoFindings(w, FIXTURE_TODAY).income, 2300);
});
test("weekly average uses complete weeks and excludes income, transfers, pending and excluded activity", () => {
  const w = fixture(),
    template = w.transactions.find((t) => t.type === "expense")!;
  w.transactions = [
    {
      ...template,
      id: "a",
      date: "2026-07-13",
      amount: 70,
      category: "Groceries",
    },
    {
      ...template,
      id: "b",
      date: "2026-07-20",
      amount: 140,
      category: "Dining",
    },
    { ...template, id: "partial", date: "2026-07-28", amount: 9999 },
    {
      ...template,
      id: "pending",
      date: "2026-07-15",
      amount: 9999,
      pending: true,
    },
    {
      ...template,
      id: "excluded",
      date: "2026-07-15",
      amount: 9999,
      excluded: true,
    },
    {
      ...template,
      id: "income",
      date: "2026-07-15",
      amount: 9999,
      type: "income",
    },
  ];
  const f = demoFindings(w, FIXTURE_TODAY);
  assert.equal(f.weeks, 2);
  assert.equal(f.weekly, 105);
  assert.equal(f.rows.find((r) => r.label === "Groceries")?.amount, 35);
  assert.equal(f.rows.find((r) => r.label === "Eating out")?.amount, 70);
  assert.equal(f.through, "2026-07-26");
});
test("no complete history returns zero observations rather than an invented average", () => {
  const w = fixture();
  w.transactions = [];
  const f = demoFindings(w, FIXTURE_TODAY);
  assert.equal(f.weeks, 0);
  assert.equal(f.weekly, 0);
});
