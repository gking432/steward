/** Small synthetic live-model acceptance suite. No mocks, account connections, or writes. */
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { demoWorkspace, FIXTURE_TODAY } from "../fixtures/golden-workspace";
import { toModel } from "../lib/model/convert";
import {
  openConversation,
  confirmPicture,
  receiveConversation,
} from "../lib/model/onboarding-conversation";
import { sessionWorkspace } from "../lib/model/planning-session";
import type { ChatDraft, ChatTurn } from "../lib/model/chat-plan";
import type { Workspace } from "../lib/model/types";
const deployment = process.argv[2];
if (!deployment) throw Error("Provide a Vercel deployment URL");
const dir = mkdtempSync(join(tmpdir(), "steward-onboarding-eval-"));
let session = openConversation(toModel(demoWorkspace()), FIXTURE_TODAY);
const results: unknown[] = [];
type Result = {
  origin: string;
  draft: ChatDraft;
  preview: Workspace;
  tools: string[];
  responseId?: string;
  model?: string;
  latencyMs?: number;
  error?: string;
};
async function run(name: string, text: string, check: (r: Result) => boolean) {
  const turns: ChatTurn[] = [...session.turns, { role: "user", content: text }];
  const file = join(dir, "request.json");
  writeFileSync(
    file,
    JSON.stringify({
      workspace: session.base,
      today: FIXTURE_TODAY,
      mode: "setup",
      experience: "conversation",
      stage: session.stage,
      confirmed: session.confirmed,
      draft: session.draft,
      turns,
    }),
  );
  const raw = execFileSync(
    "npx",
    [
      "--yes",
      "vercel",
      "curl",
      "/api/steward-chat",
      "--deployment",
      deployment,
      "--",
      "--silent",
      "--request",
      "POST",
      "--header",
      "Content-Type: application/json",
      "--data-binary",
      "@" + file,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 65000 },
  );
  const result: Result = JSON.parse(raw);
  const pass =
    result.origin === "model" &&
    result.tools.includes("propose_update") &&
    check(result);
  results.push({ name, input: text, pass, ...result });
  mkdirSync("outputs/evaluations", { recursive: true });
  writeFileSync(
    "outputs/evaluations/conversational-onboarding.json",
    JSON.stringify(
      { deployment, date: new Date().toISOString(), results },
      null,
      2,
    ),
  );
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}: ${result.draft?.message ?? result.error}`,
  );
  if (!pass) throw Error(`Failed ${name}`);
  session = receiveConversation(
    session,
    result.draft,
    [...turns, { role: "assistant", content: result.draft.message }],
    result.tools,
  );
}
try {
  await run(
    "future rent preserves current obligation",
    "Actually, rent goes up to $1,750 next month.",
    (r) => {
      const b = r.preview.buckets.find((b) => /rent/i.test(b.name))!;
      return (
        r.draft.responseKind === "update" &&
        b.amountDue === 1600 &&
        b.scheduledAmount?.amount === 1750 &&
        b.scheduledAmount.effectiveDate === "2026-09-01"
      );
    },
  );
  session = confirmPicture(session);
  session.turns.push(
    { role: "user", content: "Looks right" },
    {
      role: "assistant",
      content:
        "What brought you here? What would you like to feel better about with your money?",
    },
  );
  await run(
    "explores security and enjoyment without allocating",
    "I’m tired of worrying about surprise bills, but I don’t want to stop going out.",
    (r) =>
      r.draft.responseKind === "explore" &&
      r.draft.goals.length === 0 &&
      !r.draft.readyToReview &&
      (r.draft.preferences?.length ?? 0) >= 2 &&
      /\?/.test(r.draft.message),
  );
  await run(
    "multi-detail answer shapes proposal without redundant questions",
    "Start with $100 each payday toward an open-ended cushion, keep my dining budget as it is, and save for a $900 camera after the cushion. No extra debt repayment.",
    (r) =>
      r.draft.goals.length === 2 &&
      r.draft.goals[0].kind === "fund" &&
      r.draft.goals[0].contribution === 100 &&
      r.draft.goals[0].amount === null &&
      r.draft.goals[1].amount === 900 &&
      r.draft.readyToReview &&
      !r.draft.questions?.length &&
      r.preview.buckets.find((b) => b.name === "Dining")?.perCycle === 75,
  );
  await run(
    "earlier contribution revision retains camera and future rent",
    "Actually, make the cushion $50 each payday. Keep the camera and everything else.",
    (r) =>
      r.draft.goals[0].contribution === 50 &&
      r.draft.goals[1].amount === 900 &&
      r.preview.buckets.find((b) => /rent/i.test(b.name))?.scheduledAmount
        ?.amount === 1750 &&
      r.draft.readyToReview,
  );
  await run(
    "ambiguous income asks before changing",
    "My pay is going to be $4,000.",
    (r) =>
      r.draft.responseKind === "clarify" &&
      r.draft.income === null &&
      !!r.draft.questions?.length,
  );
  await run(
    "clarification retains full plan",
    "That is take-home each month, not each paycheck. Keep my current paycheck at $2,150; no income change. Please show the plan with the cushion at $50 and the camera.",
    (r) =>
      (r.draft.income === null || r.draft.income === 2150) &&
      r.draft.goals.length === 2 &&
      r.draft.goals[0].contribution === 50 &&
      r.draft.readyToReview &&
      !r.draft.questions?.length,
  );
  console.log(
    `Verified ${results.length} live turns; workspace still unapproved: ${!sessionWorkspace(session).profile.onboardingComplete}`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
