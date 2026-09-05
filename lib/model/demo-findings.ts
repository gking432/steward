import type { Workspace } from "./types";
import { liquidCash, planCycle } from "./engine";

/** Compare complete calendar weeks only: exclude partial first/current weeks. */
export function demoFindings(workspace: Workspace, today: string) {
  const day = 86400000;
  const monday = (value: string) => {
    const d = new Date(value + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.getTime();
  };
  const eligible = workspace.transactions.filter(
    (t) => !t.excluded && !t.pending && t.date < today,
  );
  const first = eligible.map((t) => t.date).sort()[0] ?? today;
  const firstTime = Date.parse(first + "T00:00:00Z");
  const start = monday(first) + (monday(first) === firstTime ? 0 : 7 * day);
  const end = monday(today);
  const weeks = Math.max(0, Math.round((end - start) / (7 * day)));
  const sums = {
    Groceries: 0,
    "Eating out": 0,
    Rent: 0,
    "Other bills": 0,
    "Everything else": 0,
  };
  for (const t of eligible) {
    const date = Date.parse(t.date + "T00:00:00Z");
    if (t.type !== "expense" || date < start || date >= end) continue;
    const c = t.category.toLowerCase();
    const group = /grocer/.test(c)
      ? "Groceries"
      : /dining|restaurant|eating/.test(c)
        ? "Eating out"
        : /housing|rent/.test(c)
          ? "Rent"
          : /utilities|bill|debt|subscription/.test(c)
            ? "Other bills"
            : "Everything else";
    sums[group] += t.amount;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const rows = Object.entries(sums).map(([label, total]) => ({
    label,
    amount: weeks ? round(total / weeks) : 0,
  }));
  return {
    cash: liquidCash(workspace),
    income: workspace.profile.takeHomePay,
    frequency: workspace.profile.payFrequency,
    weeks,
    from: new Date(start).toISOString().slice(0, 10),
    through: new Date(end - day).toISOString().slice(0, 10),
    weekly: weeks
      ? round(Object.values(sums).reduce((a, b) => a + b, 0) / weeks)
      : 0,
    rows,
    plan: planCycle(workspace, today),
  };
}
