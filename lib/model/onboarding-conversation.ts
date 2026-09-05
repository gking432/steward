import { type ChatDraft, type ChatTurn } from "./chat-plan";
import {
  createSession,
  sessionWorkspace,
  transition,
  unresolved,
  type PlanningSession,
} from "./planning-session";
import type { Workspace } from "./types";
import { billAmount, planCycle } from "./engine";

export function openConversation(workspace: Workspace, today: string): PlanningSession {
  const session = createSession(workspace, today);
  return { ...session, stage: "rhythm" as const };
}
export function confirmPicture(session: PlanningSession): PlanningSession {
  let next = session;
  for (const group of ["income", "bills", "spending"] as const)
    next = transition(next, { type: "confirmGroup", group });
  return {
    ...next,
    stage: "priorities",
    draft: { ...next.draft, pictureConfirmed: true },
  };
}
/** Interpretations update only this session. Canonical writes still require approveSession. */
export function receiveConversation(
  session: PlanningSession,
  draft: ChatDraft,
  turns: ChatTurn[],
  tools: string[],
): PlanningSession {
  // Exploration/clarification must not accidentally introduce allocations or facts.
  const discussing =
    draft.responseKind === "explore" || draft.responseKind === "clarify";
  const safe = discussing
    ? {
        ...session.draft,
        message: draft.message,
        responseKind: draft.responseKind,
        preferences: draft.preferences,
        questions: draft.questions,
        pictureConfirmed: draft.pictureConfirmed,
        readyToReview: false,
      }
    : draft;
  let next = transition(session, {
    type: "candidate",
    draft: safe,
    origin: "model",
    tools,
  });
  next = { ...transition(next, { type: "accept" }), turns, notice: "" };
  if (safe.pictureConfirmed && next.confirmed.length !== 3)
    next = confirmPicture(next);
  // Any revision invalidates the old review, but leaves all conversation visible.
  if (next.stage === "review") next = { ...next, stage: "build" };
  if (
    safe.readyToReview &&
    next.confirmed.length === 3 &&
    !unresolved(next).length
  )
    next = { ...next, stage: "build" };
  return next;
}
export function reviewConversation(session: PlanningSession) {
  if (!session.draft.readyToReview)
    throw Error("Tell Steward how you would like to shape the plan first.");
  const issues = unresolved(session);
  if (issues.length) throw Error(issues[0]);
  return transition(
    transition(
      { ...session, stage: "build" },
      { type: "go", stage: "tradeoffs" },
    ),
    { type: "go", stage: "review" },
  );
}
export const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );
export function openingFindings(session: PlanningSession, manual: boolean) {
  if (manual)
    return "Let’s build your starting picture together. What do you take home each payday, how often are you paid, and when is your next payday? You can tell me in your own words or open the optional editor.";
  const w = sessionWorkspace(session);
  const rent = w.buckets.find(
    (b) => b.kind === "reserve" && /rent/i.test(b.name),
  );
  const rhythm = {
    Weekly: "each week",
    Biweekly: "every two weeks",
    Monthly: "each month",
  }[w.profile.payFrequency];
  return `I reviewed the sample accounts and put together your starting picture. You take home ${money(w.profile.takeHomePay)} ${rhythm}${rent ? `, and ${rent.name.toLowerCase()} is ${money(billAmount(rent))} ${rent.frequency ?? ""}` : ""}. Here’s what else I found. Does everything look right, or is something missing?`;
}
export function pictureRows(session: PlanningSession) {
  const w = sessionWorkspace(session),
    plan = planCycle(w, session.asOf);
  return [
    { label: "Take-home per paycheck", value: money(w.profile.takeHomePay) },
    {
      label: "Bills · this paycheck’s reserves",
      value: money(plan?.reservesTotal ?? 0),
    },
    {
      label: "Everyday spending · per paycheck",
      value: money(plan?.spendTotal ?? 0),
    },
    {
      label: "Room for your priorities · projected",
      value: money(plan?.freeCapacity ?? 0),
    },
  ];
}
