"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  ArrowUp,
  Check,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import type { Workspace } from "../../lib/model/types";
import { chatDraftSchema, type ChatTurn } from "../../lib/model/chat-plan";
import {
  approveSession,
  assumptions,
  sessionSchema,
  sessionWorkspace,
  type PlanningSession,
} from "../../lib/model/planning-session";
import {
  confirmPicture,
  money,
  openConversation,
  openingFindings,
  pictureRows,
  receiveConversation,
  reviewConversation,
} from "../../lib/model/onboarding-conversation";
import { buildPaydayProposal } from "../../lib/model/decide";
import { planCycle, projectArrivals } from "../../lib/model/engine";
import { DemoWalkthrough } from "./demo-walkthrough";
import "./demo-walkthrough.css";

const rowSchema = z.object({ label: z.string(), value: z.string() });
const entrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  card: z
    .object({
      kind: z.enum(["picture", "correction", "plan"]),
      title: z.string(),
      rows: z.array(rowSchema),
      note: z.string(),
    })
    .optional(),
});
type Entry = z.infer<typeof entrySchema>;
const cacheSchema = z.object({
  session: sessionSchema,
  entries: z.array(entrySchema).max(120),
  phase: z.number().int().min(0).max(9),
});

function planCard(session: PlanningSession): NonNullable<Entry["card"]> {
  const w = sessionWorkspace(session),
    p = buildPaydayProposal(w, session.asOf),
    cycle = planCycle(w, session.asOf),
    dates = projectArrivals(w, session.asOf);
  return {
    kind: "plan",
    title: "Your proposed paycheck plan",
    rows: [
      { label: "Bills reserved", value: money(cycle?.reservesTotal ?? 0) },
      { label: "Everyday spending kept", value: money(cycle?.spendTotal ?? 0) },
      ...w.buckets
        .filter((b) => b.scheduledAmount)
        .map((b) => ({
          label: `${b.name} · scheduled full bill`,
          value: `${money(b.scheduledAmount!.amount)} from ${b.scheduledAmount!.effectiveDate}`,
        })),
      ...(p?.lines.map((line) => ({
        label: `${line.claim.name}${line.claim.openEnded ? " · ongoing" : ` · target ${money(line.claim.targetAmount)}`}`,
        value: `${money(line.amount)} this paycheck${!line.claim.openEnded && dates.find((d) => d.claimId === line.claim.id)?.arrivalDate ? ` · projected ${dates.find((d) => d.claimId === line.claim.id)?.arrivalDate}` : ""}`,
      })) ?? []),
    ],
    note: cycle?.shortfall
      ? `This plan is short by ${money(cycle.shortfall.amount)}. Let’s adjust it before review.`
      : "Proposed allocations only. Future dates assume the same income and spending, including scheduled bill changes. Nothing has moved.",
  };
}

export function OnboardingConversation({
  workspace,
  today,
  onDone,
  manual = false,
}: {
  workspace: Workspace;
  today: string;
  onDone: (w: Workspace) => void;
  manual?: boolean;
}) {
  const [session, setSession] = useState<PlanningSession>(() =>
    openConversation(workspace, today),
  );
  const [entries, setEntries] = useState<Entry[]>(() => {
    const s = openConversation(workspace, today);
    return [
      {
        role: "assistant",
        content: openingFindings(s, manual),
        card: {
          kind: "picture",
          title: manual ? "Your starting picture" : "From the sample accounts",
          rows: pictureRows(s),
          note: manual
            ? "Tell me what is missing. Current cash is unverified until you provide account information."
            : "Synthetic accounts · no bank connection. These are paycheck projections, not money available to spend today.",
        },
      },
    ];
  });
  const [loaded, setLoaded] = useState(false),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [storageError, setStorageError] = useState("");
  const [phase, setPhase] = useState(0);
  const [history, setHistory] = useState<number | null>(null);
  const [failedText, setFailedText] = useState("");
  const controller = useRef<AbortController | null>(null),
    requestId = useRef(0);
  const preview = sessionWorkspace(session),
    plan = planCycle(preview, today);
  const stage =
    session.stage === "review"
      ? 3
      : ["build", "tradeoffs"].includes(session.stage)
        ? 2
        : session.confirmed.length === 3
          ? 1
          : 0;
  const key = () => `steward-onboarding:${location.pathname}`;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key());
      if (raw) {
        const result = cacheSchema.safeParse(JSON.parse(raw));
        if (
          result.success &&
          result.data.session.sourceRevision === (workspace.revision ?? 0) &&
          result.data.session.asOf === today
        ) {
          queueMicrotask(() => {
            setSession(result.data.session);
            setEntries(result.data.entries);
            setPhase(result.data.phase);
          });
        } else
          queueMicrotask(() =>
            setStorageError(
              "Your saved numbers have changed. This conversation starts from the latest picture.",
            ),
          );
      }
    } catch {
      queueMicrotask(() =>
        setStorageError(
          "This browser cannot keep your draft between visits. Keep this page open while we plan.",
        ),
      );
    }
    queueMicrotask(() => setLoaded(true));
    const token = requestId,
      pending = controller;
    return () => {
      token.current++;
      pending.current?.abort();
    };
    // Restore once for this workspace entry, not after session edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      sessionStorage.setItem(
        key(),
        JSON.stringify({ session, entries, phase }),
      );
    } catch {
      queueMicrotask(() =>
        setStorageError(
          "Draft storage is full or unavailable. Keep this page open until you finish.",
        ),
      );
    }
  }, [session, entries, phase, loaded]);
  function looksRight() {
    try {
      const next = confirmPicture(session);
      const messages: ChatTurn[] = [
        { role: "user", content: "Let’s talk goals" },
        {
          role: "assistant",
          content:
            "Now, let’s talk about your goals. Why did you download Steward?",
        },
      ];
      setSession({ ...next, turns: [...next.turns, ...messages] });
      setEntries((e) => [...e, ...messages]);
      setHistory(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function send(text: string, retry = false) {
    if (busy || !text.trim() || !loaded) return;
    if (session.turns.length > 90) {
      setError(
        "This conversation is getting long. Review the current plan or use the editor to finish.",
      );
      return;
    }
    const user: ChatTurn = {
      role: "user",
      content: text.trim().slice(0, 1200),
    };
    const turns = retry ? session.turns : [...session.turns, user];
    const before = session;
    if (!retry) {
      setEntries((e) => [...e, user]);
      setSession((s) => ({ ...s, turns }));
    }
    setInput("");
    setBusy(true);
    setError("");
    setFailedText("");
    setHistory(null);
    controller.current = new AbortController();
    const id = ++requestId.current,
      timer = setTimeout(() => controller.current?.abort(), 45000);
    try {
      const response = await fetch("/api/steward-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.current.signal,
        body: JSON.stringify({
          workspace: before.base,
          today,
          mode: "setup",
          experience: "conversation",
          stage: before.stage,
          confirmed: before.confirmed,
          draft: before.draft,
          turns: turns.slice(-100),
        }),
      });
      const result = await response.json();
      if (!response.ok || result.origin !== "model")
        throw Error(result.error ?? "Steward couldn’t respond just now.");
      if (id !== requestId.current) return;
      const draft = chatDraftSchema.parse(result.draft);
      const reply: Entry = { role: "assistant", content: draft.message };
      const next = receiveConversation(
        before,
        draft,
        [...turns, { role: "assistant", content: draft.message }],
        result.tools ?? [],
      );
      const changes = draft.bucketEdits.filter(
        (b) =>
          !before.draft.bucketEdits.some(
            (old) => JSON.stringify(old) === JSON.stringify(b),
          ),
      );
      if (
        draft.responseKind !== "explore" &&
        draft.responseKind !== "clarify" &&
        (changes.length ||
          draft.income !== before.draft.income ||
          JSON.stringify(draft.timing ?? null) !==
            JSON.stringify(before.draft.timing ?? null))
      ) {
        reply.card = {
          kind: "correction",
          title: "Your planning numbers, updated",
          rows: [
            ...changes.map((change) => ({
              label:
                before.base.buckets.find((b) => b.id === change.id)?.name ??
                "Bill",
              value: `${money(change.amount)}${change.effectiveDate ? ` · bills due from ${change.effectiveDate}` : " · current amount"}`,
            })),
            ...(draft.income !== before.draft.income && draft.income !== null
              ? [
                  {
                    label: "Take-home per paycheck",
                    value: money(draft.income),
                  },
                ]
              : []),
            ...(draft.timing?.nextPayday
              ? [{ label: "Next payday", value: draft.timing.nextPayday }]
              : []),
            ...pictureRows(next).slice(-1),
          ],
          note: changes.some((b) => b.effectiveDate)
            ? "Earlier bills keep their existing amount. Future projections include the scheduled change. Your cash balance is unchanged."
            : "Updated for this conversation. Your cash balance is unchanged.",
        };
      }
      setSession(next);
      if (next.draft.readyToReview && next.confirmed.length === 3)
        reply.card = planCard(next);
      setEntries((e) => [...e, reply]);
    } catch (e) {
      if (id !== requestId.current) return;
      setError(
        e instanceof Error && e.name !== "AbortError"
          ? e.message
          : "Steward couldn’t finish that response. Your conversation and planning numbers are still here.",
      );
      setFailedText(user.content);
    } finally {
      clearTimeout(timer);
      if (id === requestId.current) setBusy(false);
    }
  }
  function review() {
    try {
      const next = reviewConversation(session);
      setSession(next);
      setEntries((e) => [
        ...e,
        {
          role: "assistant",
          content:
            "Take a final look. This plan reserves money for your priorities; it doesn’t transfer money or pay bills.",
          card: planCard(next),
        },
      ]);
      setHistory(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function approve() {
    try {
      const next = approveSession(session, workspace, today);
      try {
        sessionStorage.removeItem(key());
      } catch {
        /* Saving the plan remains possible without draft storage. */
      }
      onDone(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function advanceFinding() {
    if (phase === 8) looksRight();
    setPhase((p) => Math.min(9, p + 1));
  }
  if (phase < 9)
    return (
      <DemoWalkthrough
        workspace={preview}
        today={today}
        phase={phase}
        onNext={advanceFinding}
        onBack={() => setPhase((p) => Math.max(0, p - 1))}
      />
    );
  const assistantEntries = entries
    .map((entry, index) => ({ entry, index }))
    .filter((e) => e.entry.role === "assistant");
  const position = Math.min(
    history ?? assistantEntries.length - 1,
    assistantEntries.length - 1,
  );
  const active = assistantEntries[position];
  const latestUser = (
    history === null ? entries : entries.slice(0, active.index)
  ).findLast((e) => e.role === "user");
  return (
    <main className="dc-shell">
      <header className="dc-header">
        <span className="dw-brand">
          <Sparkles size={20} /> Steward
        </span>
        <span className="dw-demo">
          Demo ·{" "}
          {stage === 3 ? "Review" : stage === 2 ? "Your plan" : "Your goals"}
        </span>
      </header>
      <div className="dc-history">
        <button
          disabled={position === 0 || busy}
          onClick={() => setHistory(position - 1)}
          aria-label="Previous message"
        >
          <ArrowLeft size={16} />
        </button>
        <span>
          {history === null
            ? "A little conversation. A clearer plan."
            : `Message ${position + 1} of ${assistantEntries.length}`}
        </span>
        <button
          disabled={position === assistantEntries.length - 1 || busy}
          onClick={() => setHistory(position + 1)}
          aria-label="Next message"
        >
          <ArrowRight size={16} />
        </button>
      </div>
      <section className="dc-stage" aria-label="Conversation with Steward">
        {latestUser && (
          <p className="dc-user" title={latestUser.content}>
            <span>You</span>
            {latestUser.content}
          </p>
        )}
        <ChatDeck
          key={`${active.index}:${stage}`}
          entry={active.entry}
          assumptionsText={stage === 3 ? assumptions(session) : []}
          footer={
            stage === 3 ? (
              <div className="dc-approval">
                <label>
                  <input
                    type="checkbox"
                    checked={session.assumptionsAccepted}
                    onChange={(e) =>
                      setSession((s) => ({
                        ...s,
                        assumptionsAccepted: e.target.checked,
                      }))
                    }
                  />{" "}
                  I understand these are estimates and earmarks, not transfers.
                </label>
                <button
                  className="dw-next"
                  disabled={!session.assumptionsAccepted || busy}
                  onClick={approve}
                >
                  Use this plan <Check size={16} />
                </button>
              </div>
            ) : null
          }
        />
      </section>
      <div className="dc-bottom">
        {!busy && stage === 2 && session.draft.readyToReview && (
          <button
            className="dc-review"
            disabled={!!plan?.shortfall}
            onClick={review}
          >
            Review this plan <ArrowRight size={16} />
          </button>
        )}
        {busy && (
          <div className="dc-status" role="status">
            <Sparkles size={15} /> Thinking through your reply…
            <button onClick={() => controller.current?.abort()}>Stop</button>
          </div>
        )}
        {error && (
          <div className="dc-error" role="alert">
            <span>{error}</span>
            {failedText && (
              <button onClick={() => send(failedText, true)} disabled={busy}>
                <RotateCcw size={14} /> Retry
              </button>
            )}
          </div>
        )}
        {storageError && <p className="dc-storage">{storageError}</p>}
        <form
          className="dc-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <input
            aria-label="Your reply to Steward"
            id="steward-reply"
            value={input}
            maxLength={1200}
            onChange={(e) => setInput(e.target.value)}
            placeholder="What would you like to feel better about?"
          />
          <button
            type="submit"
            aria-label="Send reply"
            disabled={busy || !loaded || !input.trim()}
          >
            <ArrowUp size={21} />
          </button>
        </form>
        <p className="dc-footnote">
          Live AI conversation · Sample accounts · No money moves
        </p>
      </div>
    </main>
  );
}

function splitText(text: string, max = 240) {
  const words = text.replace(/\*\*([^*]+)\*\*/g, "$1").split(/\s+/),
    pages: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).length > max && current) {
      pages.push(current);
      current = "";
    }
    current += (current ? " " : "") + word;
  }
  if (current) pages.push(current);
  return pages;
}
function ChatDeck({
  entry,
  assumptionsText,
  footer,
}: {
  entry: Entry;
  assumptionsText: string[];
  footer: React.ReactNode;
}) {
  const pages: {
    text?: string;
    rows?: { label: string; value: string }[];
    title?: string;
  }[] = splitText(entry.content).map((text) => ({ text }));
  if (entry.card) {
    for (let i = 0; i < entry.card.rows.length; i += 2)
      pages.push({
        title: entry.card.title,
        rows: entry.card.rows.slice(i, i + 2),
      });
    for (const text of splitText(entry.card.note))
      pages.push({ title: "About this plan", text });
  }
  for (const assumption of assumptionsText)
    for (const text of splitText(assumption))
      pages.push({ title: "Before you use this plan", text });
  const [page, setPage] = useState(0),
    current = pages[Math.min(page, pages.length - 1)],
    last = page === pages.length - 1;
  return (
    <div
      className="dc-deck"
      aria-live="polite"
      role="log"
      aria-label="Steward’s reply"
    >
      <div className="dc-speaker">
        <span>
          <Sparkles size={19} />
        </span>
        Steward
      </div>
      <div className="dc-answer" key={page}>
        {current.title && <h2>{current.title}</h2>}
        {current.text && <p>{current.text}</p>}
        {current.rows && (
          <dl>
            {current.rows.map((row, i) => (
              <div key={i}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {pages.length > 1 && (
        <div className="dc-pages">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous detail"
          >
            <ArrowLeft size={16} />
          </button>
          <span>
            {page + 1} / {pages.length}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, pages.length - 1))}
            disabled={last}
          >
            {last ? "All caught up" : "Next"}
            <ArrowRight size={16} />
          </button>
        </div>
      )}
      {last && footer}
    </div>
  );
}
