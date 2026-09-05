"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Pencil,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import type { Workspace } from "../../lib/model/types";
import { chatDraftSchema, type ChatTurn } from "../../lib/model/chat-plan";
import {
  approveSession,
  assumptions,
  comparePlans,
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
import { currentLiquidity } from "../../lib/model/liquidity";
import { IncomeFacts, BucketFacts } from "./conversation-setup";
import "./conversation-setup.css";
import "./onboarding-conversation.css";

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
  const [edit, setEdit] = useState<"income" | "bills" | "spending" | null>(
    null,
  );
  const [failedText, setFailedText] = useState("");
  const controller = useRef<AbortController | null>(null),
    requestId = useRef(0),
    bottom = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const preview = sessionWorkspace(session),
    plan = planCycle(preview, today),
    liquidity = currentLiquidity(workspace, today);
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
      sessionStorage.setItem(key(), JSON.stringify({ session, entries }));
    } catch {
      queueMicrotask(() =>
        setStorageError(
          "Draft storage is full or unavailable. Keep this page open until you finish.",
        ),
      );
    }
  }, [session, entries, loaded]);
  useEffect(() => {
    const scroll = () => {
      follow.current =
        document.documentElement.scrollHeight -
          (window.scrollY + window.innerHeight) <
        240;
    };
    window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  }, []);
  useEffect(() => {
    if (follow.current && entries.length > 1)
      bottom.current?.scrollIntoView({ block: "end", behavior: "instant" });
  }, [entries.length, busy]);

  function looksRight() {
    try {
      const next = confirmPicture(session);
      const messages: ChatTurn[] = [
        { role: "user", content: "Looks right" },
        {
          role: "assistant",
          content:
            "What brought you here? What would you like to feel better about with your money?",
        },
      ];
      setSession({ ...next, turns: [...next.turns, ...messages] });
      setEntries((e) => [...e, ...messages]);
      follow.current = true;
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
    follow.current = true;
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
          JSON.stringify(draft.timing) !== JSON.stringify(before.draft.timing))
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
      setEntries((e) => [
        ...e,
        reply,
        ...(next.draft.readyToReview && next.confirmed.length === 3
          ? [
              {
                role: "assistant" as const,
                content:
                  "Here’s how your choices fit together. We can change anything before you use this plan.",
                card: planCard(next),
              },
            ]
          : []),
      ]);
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
      follow.current = true;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function approve() {
    try {
      const next = approveSession(session, workspace, today);
      try { sessionStorage.removeItem(key()); } catch { /* Saving the plan remains possible without draft storage. */ }
      onDone(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function saveFacts(w: Workspace) {
    const next: PlanningSession = {
      ...session,
      base: w,
      draft: {
        ...session.draft,
        bucketEdits: [],
        income: null,
        timing: null,
        questions: [],
        readyToReview: false,
      },
      reviewKey: null,
      assumptionsAccepted: false,
      stage: session.confirmed.length === 3 ? "priorities" : "rhythm",
    };
    next.accepted = structuredClone(next.draft);
    const content =
      "I’ve updated the starting picture from your edits. Tell me what you would like to shape next.";
    next.turns = [...next.turns, { role: "assistant", content }];
    setSession(next);
    setEntries((e) => [
      ...e,
      {
        role: "assistant",
        content,
        card: {
          kind: "picture",
          title: "Your updated picture",
          rows: pictureRows(next),
          note: "Planning numbers for this session. Your plan still needs final approval.",
        },
      },
    ]);
    setEdit(null);
  }
  const comparison = session.comparison
    ? comparePlans(session.comparison, preview, today).filter(
        (c) => c.delta !== 0 || c.beforeDate !== c.afterDate,
      )
    : [];
  return (
    <main className="oc-shell">
      <header className="oc-header">
        <Link href="/" className="oc-brand">
          <Sparkles size={19} /> steward
        </Link>
        <span className="oc-badge">
          {manual
            ? "Your planning session"
            : `Sample data · ${today} · no bank connected`}
        </span>
      </header>
      <nav aria-label="Planning progress" className="oc-progress">
        {["Your picture", "Your goals", "Your plan", "Review"].map(
          (label, i) => (
            <span
              key={label}
              aria-current={stage === i ? "step" : undefined}
              className={i <= stage ? "oc-reached" : ""}
            >
              <i>{i < stage ? <Check size={11} /> : i + 1}</i>
              {label}
            </span>
          ),
        )}
      </nav>
      <div className="oc-layout">
        <section
          className="oc-conversation"
          aria-label="Conversation with Steward"
        >
          <div className="oc-intro">
            <span>MAKE ROOM FOR WHAT MATTERS</span>
            <h1>A plan that starts with you.</h1>
          </div>
          <div
            className="oc-messages"
            role="log"
            aria-label="Planning conversation"
            aria-live="polite"
            aria-relevant="additions"
          >
            {entries.map((entry, i) => (
              <article key={i} className={`oc-message oc-${entry.role}`}>
                <span className="oc-speaker">
                  {entry.role === "assistant" ? (
                    <>
                      <Sparkles size={13} /> Steward
                    </>
                  ) : (
                    "You"
                  )}
                </span>
                <p>{entry.content}</p>
                {entry.card && (
                  <section
                    className={`oc-card oc-card-${entry.card.kind}`}
                    aria-label={entry.card.title}
                  >
                    <h2>{entry.card.title}</h2>
                    <dl>
                      {entry.card.rows.map((row, j) => (
                        <div key={j}>
                          <dt>{row.label}</dt>
                          <dd>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="oc-note">{entry.card.note}</p>
                    {i === 0 && stage === 0 && (
                      <button
                        className="oc-text"
                        onClick={() => setEdit("income")}
                        disabled={busy}
                      >
                        <Pencil size={13} /> Edit the numbers
                      </button>
                    )}
                  </section>
                )}
              </article>
            ))}
          </div>
          {!busy && stage === 0 && (
            <div className="oc-quick">
              <button onClick={looksRight} disabled={!loaded}>
                <Check size={15} /> Looks right
              </button>
            </div>
          )}
          {!busy &&
            stage === 1 &&
            session.draft.goals.length === 0 &&
            !session.draft.preferences?.length && (
              <div className="oc-quick">
                {[
                  "Build a cushion",
                  "Pay down debt",
                  "Save for something",
                  "Feel more in control",
                ].map((text) => (
                  <button key={text} onClick={() => send(text)}>
                    {text}
                  </button>
                ))}
              </div>
            )}
          {!!comparison.length && stage >= 2 && (
            <details className="oc-comparison">
              <summary>
                What changed in this proposal <ChevronDown size={14} />
              </summary>
              {comparison.map((c) => (
                <p key={c.id}>
                  {c.name}: {money(c.before)} → {money(c.after)} per paycheck
                  {!c.openEnded && c.beforeDate !== c.afterDate
                    ? ` · projected completion ${c.beforeDate ?? "not reached"} → ${c.afterDate ?? "not reached"}`
                    : ""}
                </p>
              ))}
            </details>
          )}
          {!busy && stage === 2 && session.draft.readyToReview && (
            <button
              className="oc-primary"
              onClick={review}
              disabled={!!plan?.shortfall}
            >
              Review this plan
            </button>
          )}
          {stage === 3 && (
            <section className="oc-review" aria-label="Final plan approval">
              <h2>Before you use this plan</h2>
              <ul>
                {assumptions(session).map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
              <label>
                <input
                  type="checkbox"
                  checked={session.assumptionsAccepted}
                  disabled={busy}
                  onChange={(e) =>
                    setSession((s) => ({
                      ...s,
                      assumptionsAccepted: e.target.checked,
                    }))
                  }
                />{" "}
                I understand these are planning estimates and earmarks.
              </label>
              <button
                className="oc-primary"
                disabled={busy || !session.assumptionsAccepted}
                onClick={approve}
              >
                Use this plan
              </button>
              <p>
                Want to change something? Tell Steward below. A change will need
                a fresh review.
              </p>
            </section>
          )}
          {busy && (
            <div role="status" className="oc-processing">
              <Sparkles size={16} />
              <span>Steward is thinking through your reply…</span>
              <button onClick={() => controller.current?.abort()}>Stop</button>
            </div>
          )}
          {error && (
            <div role="alert" className="oc-error">
              <p>{error}</p>
              {failedText && (
                <button onClick={() => send(failedText, true)} disabled={busy}>
                  <RotateCcw size={14} /> Retry response
                </button>
              )}
            </div>
          )}
          {storageError && (
            <p role="status" className="oc-note">
              {storageError}
            </p>
          )}
          <div ref={bottom} />
          <form
            className="oc-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <label className="oc-input-label" htmlFor="steward-reply">
              Your reply to Steward
            </label>
            <div>
              <textarea
                id="steward-reply"
                value={input}
                maxLength={1200}
                rows={2}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  stage === 0
                    ? "Tell me what looks right, or what’s changing…"
                    : "Tell me what matters, or change something…"
                }
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
              />
              <button
                type="submit"
                aria-label="Send reply"
                disabled={busy || !loaded || !input.trim()}
              >
                <ArrowUp size={21} />
              </button>
            </div>
            <small>
              Replies use OpenAI · calculations by Steward ·{" "}
              {manual ? "your session" : "fictional sample accounts"}
            </small>
          </form>
        </section>
        <aside className="oc-sidebar">
          <span className="oc-eyebrow">YOUR PICTURE, IN VIEW</span>
          <h2>
            {session.confirmed.length === 3
              ? "Starting picture confirmed"
              : "Starting picture to confirm"}
          </h2>
          <p className="oc-side-amount">{money(preview.profile.takeHomePay)}</p>
          <p>projected take-home each paycheck</p>
          <hr />
          <dl>
            <div>
              <dt>Cash today</dt>
              <dd>{liquidity.known ? money(liquidity.cash) : "Unverified"}</dd>
            </div>
            <div>
              <dt>Room for priorities</dt>
              <dd>{money(plan?.freeCapacity ?? 0)}</dd>
            </div>
          </dl>
          <p className="oc-note">
            Paycheck capacity includes future income. Cash today is separate and
            still needs to cover protected bills and reserves.
          </p>
          {!!session.draft.preferences?.length && (
            <>
              <h3>What matters to you</h3>
              <ul>
                {session.draft.preferences.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
          <button
            className="oc-text"
            onClick={() => setEdit("income")}
            disabled={busy}
          >
            <Pencil size={13} /> Open the numbers editor
          </button>
        </aside>
      </div>
      {edit && (
        <div
          className="oc-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Edit starting numbers"
        >
          <div className="oc-editor ps-shell">
            <header>
              <h2>Edit your starting numbers</h2>
              <button aria-label="Close editor" onClick={() => setEdit(null)}>
                <X size={20} />
              </button>
            </header>
            <div className="oc-quick">
              {(["income", "bills", "spending"] as const).map((group) => (
                <button
                  key={group}
                  aria-pressed={edit === group}
                  onClick={() => setEdit(group)}
                >
                  {group}
                </button>
              ))}
            </div>
            {edit === "income" ? (
              <IncomeFacts workspace={preview} onSave={saveFacts} />
            ) : (
              <BucketFacts
                workspace={preview}
                group={edit}
                onSave={saveFacts}
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}
