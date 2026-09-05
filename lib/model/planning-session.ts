import { z } from "zod";
import type { Workspace } from "./types";
import { workspaceSchema } from "./validation";
import {
  chatDraftSchema,
  EMPTY_CHAT_DRAFT,
  workspaceFromChat,
  type ChatDraft,
} from "./chat-plan";
import {
  previewAIOnboarding,
  EMPTY_AI_ONBOARDING_STATE,
} from "./onboarding-ai";
import { buildPaydayProposal, confirmProposal } from "./decide";
import { planCycle, projectArrivals } from "./engine";
const round2 = (n: number) => Math.round(n * 100) / 100;
import { currentLiquidity } from "./liquidity";

export const STAGES = [
  "start",
  "rhythm",
  "priorities",
  "build",
  "tradeoffs",
  "review",
] as const;
export type Stage = (typeof STAGES)[number];
export type SessionIntent = "setup" | "priority" | "paycheck" | "purchase";
const groupSchema = z.enum(["income", "bills", "spending"]);
export type FactGroup = z.infer<typeof groupSchema>;
const turn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(1200),
});
export const sessionSchema = z.object({
  version: z.literal(1),
  sourceRevision: z.number().int(),
  asOf: z.string(),
  intent: z.enum(["setup", "priority", "paycheck", "purchase"]),
  stage: z.enum(STAGES),
  base: workspaceSchema,
  draft: chatDraftSchema,
  accepted: chatDraftSchema,
  confirmed: z.array(groupSchema),
  turns: z.array(turn).max(100),
  comparison: workspaceSchema.nullable(),
  notice: z.string(),
  origin: z.enum(["ready", "model", "manual", "unavailable"]),
  tools: z.array(z.string()).max(12),
  reviewKey: z.string().nullable(),
  assumptionsAccepted: z.boolean(),
});
export type PlanningSession = Omit<
  z.infer<typeof sessionSchema>,
  "base" | "comparison"
> & { base: Workspace; comparison: Workspace | null };
export function createSession(
  workspace: Workspace,
  today: string,
  intent: SessionIntent = "setup",
): PlanningSession {
  return {
    version: 1,
    sourceRevision: workspace.revision ?? 0,
    asOf: today,
    intent,
    stage:
      intent === "setup"
        ? "start"
        : intent === "paycheck"
          ? "build"
          : "priorities",
    base:
      intent === "setup"
        ? previewAIOnboarding(workspace, today, EMPTY_AI_ONBOARDING_STATE)
        : structuredClone(workspace),
    draft: structuredClone(EMPTY_CHAT_DRAFT),
    accepted: structuredClone(EMPTY_CHAT_DRAFT),
    confirmed: intent === "setup" ? [] : ["income", "bills", "spending"],
    turns: [],
    comparison: null,
    notice: "",
    origin: "ready",
    tools: [],
    reviewKey: null,
    assumptionsAccepted: false,
  };
}
const content = (d: ChatDraft) =>
  JSON.stringify({
    goals: d.goals,
    bucketEdits: d.bucketEdits,
    income: d.income,
    timing: d.timing ?? null,
    purchase: d.purchase,
  });
export const hasCandidates = (s: PlanningSession) =>
  content(s.draft) !== content(s.accepted);
export const sessionWorkspace = (s: PlanningSession) =>
  workspaceFromChat(s.base, s.asOf, s.draft, s.intent === "setup");
export function unresolved(s: PlanningSession): string[] {
  const w = sessionWorkspace(s),
    issues: string[] = [];
  if (w.profile.takeHomePay <= 0)
    issues.push("Add take-home income per paycheck.");
  if (!w.profile.nextPayday) issues.push("Add the next payday.");
  if (s.confirmed.length !== 3)
    issues.push("Confirm income, bills, and everyday spending.");
  if (hasCandidates(s))
    issues.push("Confirm or edit Steward’s interpretation.");
  if (
    s.draft.goals.some(
      (g) =>
        g.kind === "payoff" &&
        !s.base.claims.some(
          (c) => c.kind === "payoff" && c.linkedAccountId === g.accountId,
        ),
    )
  )
    issues.push("Choose a known debt account for extra repayment.");
  if (
    w.buckets.some((b) => b.kind === "reserve" && (!b.dueDate || !b.frequency))
  )
    issues.push("Add a due date and frequency for each bill.");
  if (
    s.draft.goals.some(
      (g) => g.kind === "purchase" && (!g.amount || g.amount <= 0),
    )
  )
    issues.push("Add the missing purchase target.");
  if (s.draft.questions?.length) issues.push(...s.draft.questions);
  return issues;
}
export function assumptions(s: PlanningSession): string[] {
  const w = sessionWorkspace(s),
    liquid = currentLiquidity(w, s.asOf);
  return [
    "Future projections assume the same income, bill schedule, and spending each cycle.",
    "Planned contributions earmark money; they do not transfer funds or pay bills.",
    ...(liquid.known
      ? []
      : [
          "Current available cash is unverified or stale. This is a projected paycheck plan, not permission to spend today.",
        ]),
    ...(!s.draft.goals.some((g) => g.kind === "payoff") && s.intent === "setup"
      ? [
          "Only required debt minimums are included. Extra debt repayment has not been selected.",
        ]
      : []),
    ...(w.claims.some(
      (c) => c.status === "active" && c.openEnded && c.pinned === undefined,
    )
      ? [
          "An open-ended fund without a fixed contribution can take all remaining capacity ahead of lower priorities.",
        ]
      : []),
  ];
}
function reviewKey(s: PlanningSession) {
  return JSON.stringify({
    base: s.base,
    draft: content(s.draft),
    revision: s.sourceRevision,
    asOf: s.asOf,
  });
}
export type SessionEvent =
  | { type: "go"; stage: Stage }
  | { type: "facts"; base: Workspace; group: FactGroup }
  | { type: "confirmGroup"; group: FactGroup }
  | {
      type: "candidate";
      draft: ChatDraft;
      origin: "model" | "manual";
      tools?: string[];
    }
  | { type: "accept" }
  | { type: "reject" }
  | { type: "acknowledge"; value: boolean };
/** All progress is user-triggered and guarded here; model output cannot advance it. */
export function transition(
  s: PlanningSession,
  event: SessionEvent,
): PlanningSession {
  if (event.type === "go") {
    const from = STAGES.indexOf(s.stage),
      to = STAGES.indexOf(event.stage);
    if (to > from + 1) throw Error("Complete the current stage first.");
    if (to >= 2 && to > from && s.confirmed.length !== 3)
      throw Error("Confirm each group of financial facts first.");
    if (to >= 3 && to > from && unresolved(s).length)
      throw Error(unresolved(s)[0]);
    const w = sessionWorkspace(s),
      p = planCycle(w, s.asOf);
    if (event.stage === "review" && (!p || p.shortfall))
      throw Error("Resolve the paycheck shortfall before review.");
    return {
      ...s,
      stage: event.stage,
      comparison:
        event.stage === "tradeoffs" && !s.comparison ? w : s.comparison,
      reviewKey: event.stage === "review" ? reviewKey(s) : null,
      assumptionsAccepted: false,
    };
  }
  if (event.type === "facts")
    return {
      ...s,
      base: workspaceSchema.parse(JSON.parse(JSON.stringify(event.base))),
      confirmed: s.confirmed.filter((g) => g !== event.group),
      reviewKey: null,
      assumptionsAccepted: false,
      notice:
        "Starting numbers changed. Confirm this group again; allocations and dates have been recalculated.",
    };
  if (event.type === "confirmGroup") {
    const w = sessionWorkspace(s);
    if (
      event.group === "income" &&
      (!w.profile.nextPayday || w.profile.takeHomePay <= 0)
    )
      throw Error("Add a valid payday and positive take-home pay.");
    return {
      ...s,
      confirmed: [...new Set([...s.confirmed, event.group])],
      notice: "",
    };
  }
  if (event.type === "candidate")
    return {
      ...s,
      comparison:
        STAGES.indexOf(s.stage) >= 3 ? sessionWorkspace(s) : s.comparison,
      draft: chatDraftSchema.parse(event.draft),
      origin: event.origin,
      tools: event.tools ?? [],
      reviewKey: null,
      assumptionsAccepted: false,
      notice:
        "Candidate update only. Review the highlighted interpretation before keeping it.",
    };
  if (event.type === "accept")
    return {
      ...s,
      accepted: structuredClone(s.draft),
      reviewKey: null,
      notice:
        "Interpretation confirmed for this session. Your saved workspace is unchanged.",
    };
  if (event.type === "reject")
    return {
      ...s,
      draft: structuredClone(s.accepted),
      reviewKey: null,
      notice: "Candidate discarded. Your previous choices are retained.",
    };
  return { ...s, assumptionsAccepted: event.value };
}
export function approveSession(
  s: PlanningSession,
  current: Workspace,
  today: string,
): Workspace {
  if (
    s.stage !== "review" ||
    s.reviewKey !== reviewKey(s) ||
    !s.assumptionsAccepted
  )
    throw Error("Review this exact proposal and its assumptions first.");
  if ((current.revision ?? 0) !== s.sourceRevision || s.asOf !== today)
    throw Error(
      "The workspace or date changed. Start a fresh review with the latest context.",
    );
  const issues = unresolved(s);
  if (issues.length) throw Error(issues[0]);
  const w = sessionWorkspace(s),
    plan = planCycle(w, today),
    proposal = buildPaydayProposal(w, today);
  if (!proposal || !plan || plan.shortfall)
    throw Error("The plan is incomplete or has a shortfall.");
  const result = confirmProposal(w, proposal);
  return {
    ...result,
    profile: { ...result.profile, onboardingComplete: true },
  };
}
export function comparePlans(
  before: Workspace,
  after: Workspace,
  today: string,
) {
  const b = buildPaydayProposal(before, today),
    a = buildPaydayProposal(after, today);
  const bd = projectArrivals(before, today),
    ad = projectArrivals(after, today);
  const ids = new Set(
    [...before.claims, ...after.claims]
      .filter((c) => c.status === "active")
      .map((c) => c.id),
  );
  return [...ids].map((id) => {
    const old = before.claims.find((c) => c.id === id),
      next = after.claims.find((c) => c.id === id);
    const from = b?.lines.find((l) => l.claim.id === id)?.amount ?? 0,
      to = a?.lines.find((l) => l.claim.id === id)?.amount ?? 0;
    return {
      id,
      name: next?.name ?? old?.name ?? id,
      before: from,
      after: to,
      delta: round2(to - from),
      beforeDate: bd.find((d) => d.claimId === id)?.arrivalDate ?? null,
      afterDate: ad.find((d) => d.claimId === id)?.arrivalDate ?? null,
      openEnded: next?.openEnded ?? false,
    };
  });
}

/** Reset only this route's planning history; unrelated manual/sample routes survive. */
export function clearPlanningDrafts(
  storage: Pick<Storage, "removeItem">,
  pathname: string,
) {
  for (const intent of ["setup", "priority", "paycheck", "purchase"])
    storage.removeItem(`steward-planning:${pathname}:${intent}`);
  storage.removeItem(`steward-chat:${pathname}`);
  storage.removeItem(`steward-onboarding:${pathname}`);
}
