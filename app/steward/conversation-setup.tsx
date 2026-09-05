"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Leaf,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import type { Bucket, Workspace } from "../../lib/model/types";
import { type ChatDraft, type ChatTurn } from "../../lib/model/chat-plan";
import {
  buildPaydayProposal,
  evaluatePurchase,
  type Verdict,
} from "../../lib/model/decide";
import { formatMoney, planCycle } from "../../lib/model/engine";
import { currentLiquidity } from "../../lib/model/liquidity";
import {
  approveSession,
  assumptions,
  comparePlans,
  createSession,
  hasCandidates,
  sessionSchema,
  sessionWorkspace,
  STAGES,
  transition,
  unresolved,
  type FactGroup,
  type SessionEvent,
  type SessionIntent,
} from "../../lib/model/planning-session";
import "./conversation-setup.css";

const labels = [
  "Starting point",
  "Financial rhythm",
  "Your priorities",
  "Build the plan",
  "Trade-offs",
  "Review",
];
const titles = [
  "A little clarity. A plan that fits.",
  "First, find your rhythm.",
  "What would feeling better look like?",
  "Give every dollar a purpose.",
  "Find your balance.",
  "Your plan. Your decision.",
];
const intros = [
  "We’ll start with what comes in, protect what needs to go out, and make room for what matters to you.",
  "These are starting facts, not final answers. Confirm what looks right and correct what doesn’t.",
  "Tell Steward about your priorities in your own words. You’ll review its interpretation before anything changes.",
  "Your confirmed choices, calculated into one paycheck. Future income and money available today stay separate.",
  "Try a different contribution or priority. See what changes before you commit.",
  "Review the exact allocations and the assumptions behind them. Approval earmarks money in your plan.",
];
const money = (n: number) => formatMoney(n);

export function ConversationSetup({
  workspace,
  today,
  onDone,
  manual = false,
  intent = "setup",
  onCancel,
}: {
  workspace: Workspace;
  today: string;
  onDone: (w: Workspace) => void;
  manual?: boolean;
  intent?: SessionIntent;
  onCancel?: () => void;
}) {
  const [session, setSession] = useState(() =>
    createSession(workspace, today, intent),
  );
  const [loaded, setLoaded] = useState(false),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [storageError, setStorageError] = useState("");
  const [factsDirty, setFactsDirty] = useState(false);
  const [editingGoal, setEditingGoal] = useState("new");
  const [group, setGroup] = useState<FactGroup>("income"),
    [manualGoal, setManualGoal] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    controller = useRef<AbortController | null>(null);
  const requestId = useRef(0);
  const cacheKey = useCallback(
    () => `steward-planning:${location.pathname}:${intent}`,
    [intent],
  );
  const preview = useMemo(() => sessionWorkspace(session), [session]);
  const plan = useMemo(() => planCycle(preview, today), [preview, today]);
  const proposal = useMemo(
    () => buildPaydayProposal(preview, today),
    [preview, today],
  );
  const liquidity = useMemo(
    () => currentLiquidity(workspace, today),
    [workspace, today],
  );
  const changes = useMemo(
    () => comparePlans(session.comparison ?? session.base, preview, today),
    [session.comparison, session.base, preview, today],
  );
  const stageIndex = STAGES.indexOf(session.stage),
    pending = hasCandidates(session),
    issues = unresolved(session);
  const stale =
    (workspace.revision ?? 0) !== session.sourceRevision ||
    today !== session.asOf;
  const groups: FactGroup[] = ["income", "bills", "spending"];
  useEffect(() => {
    try {
      const cache = sessionStorage.getItem(cacheKey());
      if (cache) {
        const result = sessionSchema.safeParse(JSON.parse(cache));
        if (result.success && result.data.intent === intent)
          queueMicrotask(() => setSession(result.data));
        else
          queueMicrotask(() =>
            setStorageError(
              "The previous draft could not be restored. Start with the current workspace.",
            ),
          );
      }
    } catch {
      queueMicrotask(() =>
        setStorageError(
          "Draft storage is unavailable. Keep this page open until you finish.",
        ),
      );
    }
    queueMicrotask(() => setLoaded(true));
    const token = requestId;
    const pendingRequest = controller;
    return () => {
      token.current++;
      pendingRequest.current?.abort();
    };
    // Cache belongs to this mounted session; intent changes mount a fresh component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (loaded)
      try {
        sessionStorage.setItem(cacheKey(), JSON.stringify(session));
      } catch {
        queueMicrotask(() =>
          setStorageError(
            "This draft could not be stored. Keep the page open until you finish.",
          ),
        );
      }
  }, [session, loaded, cacheKey]);
  useEffect(() => {
    if (loaded) {
      heading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [session.stage, loaded]);
  function act(event: SessionEvent) {
    try {
      setSession(transition(session, event));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please check the inputs.");
    }
  }
  function changeFacts(base: Workspace, section: FactGroup) {
    try {
      // Direct edits supersede the corresponding AI candidate, not vice versa.
      const clean = (d: ChatDraft): ChatDraft => ({
        ...d,
        income: section === "income" ? null : d.income,
        timing: section === "income" ? null : d.timing,
        bucketEdits: d.bucketEdits.filter(
          (e) =>
            !base.buckets.some(
              (b) =>
                b.id === e.id &&
                (section === "bills"
                  ? b.kind === "reserve"
                  : section === "spending" && b.kind === "spend"),
            ),
        ),
        questions: [],
      });
      const next = transition(
        {
          ...session,
          draft: clean(session.draft),
          accepted: clean(session.accepted),
        },
        { type: "facts", base, group: section },
      );
      setSession(next);
      setFactsDirty(false);
      setError("");
    } catch {
      setError(
        "Use valid dates and nonnegative amounts with at most two decimal places.",
      );
    }
  }
  async function send(text = input, retry = false) {
    if (!text.trim() || busy || stale) return;
    const id = ++requestId.current;
    const next: ChatTurn[] = retry
      ? session.turns
      : [...session.turns, { role: "user", content: text.trim() }];
    setSession((s) => ({ ...s, turns: next }));
    setInput("");
    setBusy(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 45000);
    try {
      const response = await fetch("/api/steward-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspace: session.base,
          today,
          mode: intent === "setup" ? "setup" : "ask",
          stage: session.stage,
          confirmed: session.confirmed,
          draft: session.draft,
          turns: next.slice(-30),
        }),
        signal: abort.signal,
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error ?? "The AI connection is unavailable.");
      if (id !== requestId.current) return;
      setSession((s) => ({
        ...transition(s, {
          type: "candidate",
          draft: result.draft,
          origin: "model",
          tools: result.tools,
        }),
        turns: [
          ...next,
          { role: "assistant", content: result.draft.message },
        ].slice(-100) as ChatTurn[],
      }));
      setVerdict(result.verdict);
    } catch (err) {
      if (id === requestId.current) {
        setError(
          err instanceof Error && err.name !== "AbortError"
            ? err.message
            : "The AI request was interrupted. Your previous draft is intact. Retry or continue with manual controls.",
        );
        setSession((s) => ({ ...s, origin: "unavailable" }));
      }
    } finally {
      clearTimeout(timer);
      if (id === requestId.current) setBusy(false);
    }
  }
  function cancelRequest() {
    requestId.current++;
    controller.current?.abort();
    setBusy(false);
    setError(
      "Request stopped. Your previous draft is intact. You can retry or use manual controls.",
    );
    setSession((s) => ({ ...s, origin: "unavailable" }));
  }
  function manualCandidate(draft: ChatDraft, evidence: string) {
    try {
      const next = transition(session, {
        type: "candidate",
        draft: { ...draft, questions: [] },
        origin: "manual",
      });
      setSession({
        ...next,
        turns: [...session.turns, { role: "user", content: evidence }].slice(
          -100,
        ) as ChatTurn[],
      });
      setManualGoal(false);
      setVerdict(null);
      setError("");
    } catch {
      setError("Check the priority amounts, date, and required fields.");
    }
  }
  function approve() {
    try {
      const next = approveSession(session, workspace, today);
      sessionStorage.removeItem(cacheKey());
      onDone(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not apply the proposal.",
      );
    }
  }
  function cancel() {
    requestId.current++;
    controller.current?.abort();
    try {
      sessionStorage.removeItem(cacheKey());
    } catch {}
    if (onCancel) onCancel();
    else {
      setSession(createSession(workspace, today, intent));
      setError("");
    }
  }
  const origin =
    session.origin === "model"
      ? "Live AI · verified tools"
      : session.origin === "manual"
        ? "Manual planning"
        : session.origin === "unavailable"
          ? "AI unavailable · manual planning available"
          : "AI ready when you send a message";
  const contributions = proposal?.lines.reduce((n, l) => n + l.amount, 0) ?? 0;
  const unallocated = Math.max(
    0,
    (proposal?.freeCapacity ?? 0) - contributions,
  );
  const allocationRows = plan
    ? [
        { name: "Bills & reserves", amount: plan.reservesTotal, tone: "bills" },
        { name: "Everyday spending", amount: plan.spendTotal, tone: "spend" },
        { name: "Buffer protection", amount: plan.bufferTopUp, tone: "buffer" },
        { name: "Your priorities", amount: contributions, tone: "goals" },
        { name: "Unallocated", amount: unallocated, tone: "unassigned" },
      ]
    : [];
  return (
    <main className="ps-shell">
      <header className="ps-header">
        <Link href="/" className="ps-brand">
          <Leaf size={23} />
          Steward
        </Link>
        <span>
          {manual ? "Manual workspace" : "Sample workspace · synthetic data"} ·{" "}
          {today}
        </span>
        {onCancel ? (
          <button onClick={onCancel}>Return home</button>
        ) : (
          <Link href="/fixture">Explore a sample plan</Link>
        )}
      </header>
      <nav className="ps-progress" aria-label="Planning progress">
        {labels.map((label, i) => (
          <button
            key={label}
            disabled={busy || i > stageIndex}
            aria-current={i === stageIndex ? "step" : undefined}
            onClick={() => act({ type: "go", stage: STAGES[i] })}
          >
            <span>{i < stageIndex ? <Check size={14} /> : i + 1}</span>
            <b>{label}</b>
          </button>
        ))}
      </nav>
      <div className="ps-layout">
        <section className="ps-canvas" aria-busy={busy}>
          <fieldset
            className="ps-stage"
            key={session.stage}
            disabled={busy}
            onChangeCapture={(e) => {
              if (
                session.stage === "rhythm" &&
                (e.target as HTMLElement).closest(".ps-facts")
              )
                setFactsDirty(true);
            }}
          >
            <p className="ps-eyebrow">
              {intent === "purchase"
                ? "Explore a purchase"
                : intent === "priority"
                  ? "Adjust a priority"
                  : intent === "paycheck"
                    ? "Review this paycheck"
                    : `Your planning session · ${stageIndex + 1} of 6`}
            </p>
            <h1 tabIndex={-1} ref={heading}>
              {intent === "purchase" && session.stage === "priorities"
                ? "Make room for something new."
                : titles[stageIndex]}
            </h1>
            <p className="ps-intro">{intros[stageIndex]}</p>
            {session.stage === "start" && (
              <>
                <div
                  className="ps-start-visual"
                  aria-label="A plan in three parts"
                >
                  <span>Protect the essentials</span>
                  <span>Make room for life</span>
                  <span>Move toward your priorities</span>
                </div>
                <div className="ps-start-options">
                  <button
                    className="ps-primary"
                    onClick={() => act({ type: "go", stage: "rhythm" })}
                  >
                    {manual
                      ? "Start with my numbers"
                      : "Use the sample numbers"}{" "}
                    <ArrowRight size={17} />
                  </button>
                  {!manual && (
                    <Link href="/manual">Start with my own numbers</Link>
                  )}
                </div>
                <p className="ps-muted">
                  {manual
                    ? "Enter only the facts you know. You can plan without connecting a bank."
                    : "Try a complete planning session with synthetic statements. No bank connection needed."}
                </p>
              </>
            )}
            {session.stage === "rhythm" && (
              <>
                <div className="ps-groups" aria-label="Financial fact groups">
                  {groups.map((g) => (
                    <button
                      key={g}
                      aria-pressed={group === g}
                      disabled={factsDirty}
                      onClick={() => setGroup(g)}
                    >
                      {session.confirmed.includes(g) && <Check size={15} />}{" "}
                      {g === "income"
                        ? "Income & timing"
                        : g === "bills"
                          ? "Bills & minimums"
                          : "Everyday spending"}
                    </button>
                  ))}
                </div>
                <div className="ps-fact-heading">
                  <h2>
                    {group === "income"
                      ? "The money coming in"
                      : group === "bills"
                        ? "The things to protect"
                        : "Room for everyday life"}
                  </h2>
                  <span
                    className={`ps-badge ${session.confirmed.includes(group) ? "confirmed" : ""}`}
                  >
                    {session.confirmed.includes(group)
                      ? "Confirmed"
                      : "Needs your confirmation"}
                  </span>
                </div>
                {group === "income" ? (
                  <IncomeFacts
                    key={JSON.stringify(preview.profile)}
                    workspace={preview}
                    onSave={(w) => changeFacts(w, "income")}
                  />
                ) : (
                  <BucketFacts
                    key={JSON.stringify(preview.buckets)}
                    workspace={preview}
                    group={group}
                    onSave={(w) => changeFacts(w, group)}
                  />
                )}
                <button
                  className="ps-primary"
                  disabled={busy || factsDirty}
                  onClick={() => {
                    try {
                      setSession(
                        transition(session, { type: "confirmGroup", group }),
                      );
                      setError("");
                      if (group === "income") setGroup("bills");
                      else if (group === "bills") setGroup("spending");
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }}
                >
                  {factsDirty
                    ? "Save corrections above first"
                    : session.confirmed.includes(group)
                      ? "Confirm again"
                      : "These facts look right"}{" "}
                  <Check size={16} />
                </button>
              </>
            )}
            {session.stage === "priorities" && (
              <>
                <div className="ps-chips">
                  {(intent === "purchase"
                    ? [
                        "Can I afford groceries?",
                        "I’m considering a purchase, but I’m not sure yet",
                      ]
                    : [
                        "Build a cushion",
                        "Pay down debt",
                        "Save for a purchase",
                        "Prepare for a move",
                      ]
                  ).map((text) => (
                    <button
                      key={text}
                      disabled={busy}
                      onClick={() => send(text)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                {intent !== "setup" &&
                  preview.claims.some((c) => c.status === "active") && (
                    <div className="ps-existing">
                      <h2>Your current priorities</h2>
                      {preview.claims
                        .filter((c) => c.status === "active")
                        .sort((a, b) => a.rank - b.rank)
                        .map((c) => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setEditingGoal(c.id);
                              setManualGoal(true);
                            }}
                          >
                            {c.name}
                            <span>
                              {c.pinned !== undefined
                                ? money(c.pinned) + " / paycheck"
                                : "By priority"}
                            </span>
                            <SlidersHorizontal size={15} />
                          </button>
                        ))}
                    </div>
                  )}
                {!session.draft.goals.length && intent === "setup" && (
                  <div className="ps-empty">
                    <Sparkles size={26} />
                    <p>
                      A cushion for surprises. A move on the horizon. A little
                      less stress.
                    </p>
                    <small>
                      Start with what matters; the numbers can follow.
                    </small>
                  </div>
                )}
              </>
            )}
            {(session.stage === "build" || session.stage === "tradeoffs") &&
              plan && (
                <>
                  <div className="ps-paycheck">
                    <span>Projected paycheck</span>
                    <strong>{money(plan.income)}</strong>
                    <small>
                      {plan.cycle.start} – {plan.cycle.end}
                    </small>
                  </div>
                  <div
                    className="ps-allocation"
                    aria-label="Projected paycheck allocation"
                  >
                    {allocationRows
                      .filter((r) => r.amount > 0)
                      .map((r) => (
                        <span
                          key={r.name}
                          className={r.tone}
                          style={{ flexGrow: r.amount }}
                          title={`${r.name}: ${money(r.amount)}`}
                        />
                      ))}
                  </div>
                  <div className="ps-allocation-legend">
                    {allocationRows.map((r) => (
                      <div key={r.name}>
                        <i className={r.tone} />
                        <span>{r.name}</span>
                        <strong>{money(r.amount)}</strong>
                      </div>
                    ))}
                  </div>
                  {session.stage === "tradeoffs" && (
                    <>
                      <h2>Before & after</h2>
                      <p className="ps-muted">
                        Compared with{" "}
                        {session.comparison
                          ? "the proposal before your latest adjustment"
                          : "your starting plan"}
                        . Bills and everyday allowances stay fixed unless you
                        explicitly edit them.
                      </p>
                      <div className="ps-comparisons">
                        {changes.map((c) => (
                          <article
                            key={c.id}
                            className={
                              c.delta !== 0 || c.beforeDate !== c.afterDate
                                ? "changed"
                                : ""
                            }
                          >
                            <h3>{c.name}</h3>
                            <div>
                              <span>
                                Before<strong>{money(c.before)}</strong>
                              </span>
                              <ArrowRight size={17} />
                              <span>
                                Proposed<strong>{money(c.after)}</strong>
                              </span>
                            </div>
                            <p>
                              {c.openEnded
                                ? "Open-ended savings · no completion date"
                                : `Projected completion: ${c.beforeDate ?? "No date projected"} → ${c.afterDate ?? "No date within projection"}`}
                            </p>
                            <small>
                              {c.delta !== 0
                                ? `${c.delta > 0 ? "+" : ""}${money(c.delta)} this paycheck as contributions and priority order change.`
                                : "No contribution change this paycheck."}
                            </small>
                          </article>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            {session.stage !== "start" && session.stage !== "review" && (
              <>
                {session.draft.goals.length > 0 && (
                  <div className="ps-goal-list">
                    <div className="ps-fact-heading">
                      <h2>
                        {session.stage === "tradeoffs"
                          ? "Adjust your priorities"
                          : "Your priorities"}
                      </h2>
                      <span
                        className={`ps-badge ${pending ? "" : "confirmed"}`}
                      >
                        {pending
                          ? "Candidate interpretation"
                          : "Confirmed choices"}
                      </span>
                    </div>
                    {session.draft.goals.map((g, i) => (
                      <article key={g.id}>
                        <span className="ps-rank">{i + 1}</span>
                        <div>
                          <h3>{g.name}</h3>
                          <p>
                            {g.amount === null
                              ? g.kind === "fund"
                                ? "Open-ended savings"
                                : "Target needed"
                              : money(g.amount) + " target"}
                            {g.date ? ` · wanted by ${g.date}` : ""}
                          </p>
                          <small>
                            {g.contribution != null
                              ? `${money(g.contribution)} per paycheck`
                              : "Contribution follows priority order"}
                          </small>
                        </div>
                        <button
                          aria-label={`Edit ${g.name}`}
                          disabled={busy}
                          onClick={() => {
                            setEditingGoal(g.id);
                            setManualGoal(true);
                          }}
                        >
                          <SlidersHorizontal size={17} />
                        </button>
                      </article>
                    ))}
                  </div>
                )}
                {(session.stage === "priorities" ||
                  session.stage === "tradeoffs") && (
                  <button
                    className="ps-text-button"
                    disabled={busy}
                    onClick={() => {
                      setEditingGoal("new");
                      setManualGoal(!manualGoal);
                    }}
                  >
                    <SlidersHorizontal size={16} />{" "}
                    {manualGoal
                      ? "Close manual controls"
                      : "Add or edit a priority manually"}
                  </button>
                )}
                {manualGoal && (
                  <GoalEditor
                    key={editingGoal}
                    initial={editingGoal}
                    draft={session.draft}
                    workspace={preview}
                    onSave={manualCandidate}
                  />
                )}
                {session.origin === "model" &&
                  session.draft.message !== "Ready to talk." && (
                    <div className="ps-guidance">
                      <Sparkles size={18} />
                      <div>
                        <span className="ps-eyebrow">Steward · live AI</span>
                        <p>{session.draft.message}</p>
                      </div>
                    </div>
                  )}
                {(session.draft.questions?.length ?? 0) > 0 && (
                  <ul className="ps-questions">
                    {session.draft.questions?.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                )}
                {pending && (
                  <div
                    className="ps-candidate"
                    role="region"
                    aria-label="Candidate interpretation"
                  >
                    <strong>Does this match what you meant?</strong>
                    {session.draft.income !== null && (
                      <p>Take-home pay: {money(session.draft.income)}</p>
                    )}
                    {session.draft.timing && (
                      <p>
                        Pay timing: {session.draft.timing.payFrequency}{" "}
                        {session.draft.timing.nextPayday}
                      </p>
                    )}
                    {session.draft.bucketEdits.map((e) => (
                      <p key={e.id}>
                        {preview.buckets.find((b) => b.id === e.id)?.name}:{" "}
                        {money(e.amount)}
                      </p>
                    ))}
                    {session.draft.purchase && (
                      <p>
                        Purchase check: {session.draft.purchase.name} ·{" "}
                        {session.draft.purchase.amount === null
                          ? "Amount needed"
                          : money(session.draft.purchase.amount)}
                      </p>
                    )}
                    <p className="ps-muted">
                      Keeping an interpretation confirms your intent for this
                      session. Final approval comes later.
                    </p>
                    <div className="ps-actions">
                      <button
                        className="ps-primary"
                        disabled={busy}
                        onClick={() => act({ type: "accept" })}
                      >
                        Keep this interpretation
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => act({ type: "reject" })}
                      >
                        Discard update
                      </button>
                    </div>
                  </div>
                )}
                <form
                  className="ps-composer"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <label htmlFor="setup-message">
                    {session.stage === "rhythm"
                      ? "Tell Steward what needs correcting"
                      : session.stage === "tradeoffs"
                        ? "Try a different direction"
                        : "Tell Steward what’s on your mind"}
                  </label>
                  <div>
                    <textarea
                      id="setup-message"
                      maxLength={1000}
                      rows={2}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={
                        session.stage === "tradeoffs"
                          ? "What if I save less this paycheck?"
                          : session.stage === "rhythm"
                            ? "My paycheck amount has changed…"
                            : "I want a cushion, but I’m also saving for…"
                      }
                      disabled={busy}
                    />
                    <button
                      className="ps-primary"
                      disabled={busy || !input.trim() || stale}
                      type="submit"
                      aria-label="Send to Steward"
                    >
                      <ArrowRight size={20} />
                    </button>
                  </div>
                  <small>{origin}</small>
                </form>
                {intent === "purchase" && (
                  <ManualPurchase
                    workspace={workspace}
                    today={today}
                    onResult={setVerdict}
                  />
                )}
                {verdict && (
                  <section className="ps-verdict">
                    <span className="ps-eyebrow">
                      Calculated purchase check
                    </span>
                    <h2>{verdict.headline}</h2>
                    <p>
                      {verdict.item} · {money(verdict.price)}
                    </p>
                    <p>{verdict.tradeoff}</p>
                    {verdict.checks.map((c) => (
                      <p key={c.label}>
                        <strong>{c.label}:</strong> {c.detail}
                      </p>
                    ))}
                  </section>
                )}
              </>
            )}
            {session.stage === "review" && proposal && plan && (
              <section aria-label="Review paycheck proposal">
                <div className="ps-review-stamp">
                  <Check size={22} />
                  <span>
                    Calculated proposal · source revision{" "}
                    {session.sourceRevision}
                    <small>Not yet applied</small>
                  </span>
                </div>
                <h2>Exact plan changes</h2>
                <dl className="ps-review-rows">
                  {session.base.profile.takeHomePay !==
                    workspace.profile.takeHomePay ||
                  session.draft.income !== null ? (
                    <div>
                      <dt>Take-home per paycheck</dt>
                      <dd>
                        {money(workspace.profile.takeHomePay)} →{" "}
                        {money(preview.profile.takeHomePay)}
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Pay schedule</dt>
                    <dd>
                      {preview.profile.payFrequency} ·{" "}
                      {preview.profile.nextPayday}
                    </dd>
                  </div>
                  {preview.buckets.map((b) => {
                    const old = workspace.buckets.find((x) => x.id === b.id);
                    const from =
                        b.kind === "reserve" ? old?.amountDue : old?.perCycle,
                      to = b.kind === "reserve" ? b.amountDue : b.perCycle;
                    return from !== to ? (
                      <div key={b.id}>
                        <dt>
                          {b.name} ·{" "}
                          {b.kind === "reserve" ? "full bill" : "allowance"}
                        </dt>
                        <dd>
                          {money(from ?? 0)} → {money(to ?? 0)}
                        </dd>
                      </div>
                    ) : null;
                  })}
                  {preview.claims
                    .filter((c) => c.status === "active")
                    .sort((a, b) => a.rank - b.rank)
                    .map((c) => (
                      <div key={c.id}>
                        <dt>
                          {c.name}
                          <small>
                            Priority {c.rank + 1} ·{" "}
                            {c.openEnded
                              ? "open-ended"
                              : money(c.targetAmount) + " target"}
                            {c.wantBy ? ` · wanted by ${c.wantBy}` : ""}
                          </small>
                        </dt>
                        <dd>
                          {c.pinned !== undefined
                            ? money(c.pinned) + " / paycheck"
                            : "By priority"}
                        </dd>
                      </div>
                    ))}
                </dl>
                {workspace.claims
                  .filter(
                    (c) =>
                      c.status === "active" &&
                      preview.claims.find((n) => n.id === c.id)?.status !==
                        "active",
                  )
                  .map((c) => (
                    <p className="ps-muted" key={c.id}>
                      {c.kind === "payoff"
                        ? `Extra repayment toward ${c.name}: not included. Required minimums remain in bills.`
                        : `${c.name}: removed from active funding; existing earmarks retained.`}
                    </p>
                  ))}
                <h2>This paycheck’s earmarks</h2>
                <dl className="ps-review-rows">
                  {plan.reserves.map((r) => (
                    <div key={r.bucket.id}>
                      <dt>
                        {r.bucket.name}
                        <small>
                          Full bill {money(r.bucket.amountDue ?? 0)} · due{" "}
                          {r.bucket.dueDate}
                          <br />
                          Usual {money(r.steadyRate)}
                          {r.required > r.steadyRate
                            ? ` · catch-up +${money(r.required - r.steadyRate)}`
                            : ""}
                        </small>
                      </dt>
                      <dd>{money(r.required)}</dd>
                    </div>
                  ))}
                  {proposal.spend.map((r) => (
                    <div key={r.name}>
                      <dt>{r.name}</dt>
                      <dd>{money(r.amount)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Buffer top-up</dt>
                    <dd>{money(proposal.bufferTopUp)}</dd>
                  </div>
                  {proposal.lines.map((r) => (
                    <div key={r.claim.id}>
                      <dt>
                        {r.claim.name}
                        <small>{r.reason}</small>
                      </dt>
                      <dd>{money(r.amount)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Unallocated</dt>
                    <dd>{money(unallocated)}</dd>
                  </div>
                </dl>
                <h2>What this plan assumes</h2>
                <ul className="ps-assumptions">
                  {assumptions(session).map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <label className="ps-ack">
                  <input
                    type="checkbox"
                    checked={session.assumptionsAccepted}
                    onChange={(e) =>
                      act({ type: "acknowledge", value: e.target.checked })
                    }
                  />
                  I’ve reviewed these amounts and assumptions. I understand this
                  does not move money.
                </label>
                <button
                  className="ps-primary"
                  disabled={
                    !session.assumptionsAccepted ||
                    busy ||
                    stale ||
                    issues.length > 0
                  }
                  onClick={approve}
                >
                  Approve this paycheck plan <Check size={17} />
                </button>
              </section>
            )}
          </fieldset>
          {busy && (
            <div className="ps-status" role="status">
              <Sparkles size={18} />
              <span>
                Steward is interpreting your message and using planning tools.
              </span>
              <button onClick={cancelRequest}>Stop</button>
            </div>
          )}
          {session.notice && (
            <p className="ps-notice" role="status">
              {session.notice}
            </p>
          )}
          {(error || storageError || stale) && (
            <div className="ps-error" role="alert">
              {stale
                ? "Your workspace or planning date changed. Start a fresh session to review the latest context."
                : error || storageError}
              <div className="ps-actions">
                {stale ? (
                  <button
                    onClick={() =>
                      setSession(createSession(workspace, today, intent))
                    }
                  >
                    Start fresh with current data
                  </button>
                ) : (
                  session.origin === "unavailable" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        send(
                          session.turns.filter((t) => t.role === "user").at(-1)
                            ?.content ?? "",
                          true,
                        )
                      }
                    >
                      Retry message
                    </button>
                  )
                )}
              </div>
            </div>
          )}
          {plan?.shortfall && (
            <p className="ps-error" role="alert">
              This paycheck is short by {money(plan.shortfall.amount)}. Edit
              your starting numbers or priorities before approval.
            </p>
          )}
          {stageIndex > 0 && (
            <footer className="ps-stage-footer">
              <button
                disabled={busy}
                onClick={() =>
                  act({ type: "go", stage: STAGES[stageIndex - 1] })
                }
              >
                <ChevronLeft size={17} />
                Back
              </button>
              {stageIndex < 5 && (
                <button
                  className="ps-primary"
                  disabled={
                    busy ||
                    stale ||
                    factsDirty ||
                    (session.stage === "rhythm" &&
                      session.confirmed.length !== 3) ||
                    (stageIndex >= 2 && issues.length > 0)
                  }
                  onClick={() =>
                    act({ type: "go", stage: STAGES[stageIndex + 1] })
                  }
                >
                  {session.stage === "rhythm"
                    ? "Talk about priorities"
                    : session.stage === "priorities"
                      ? "Build my plan"
                      : session.stage === "build"
                        ? "Explore trade-offs"
                        : "Review this plan"}{" "}
                  <ArrowRight size={17} />
                </button>
              )}
            </footer>
          )}
          {stageIndex >= 2 && issues.length > 0 && (
            <p className="ps-muted">Before continuing: {issues.join(" ")}</p>
          )}
          {stageIndex > 0 && (
            <details className="ps-history">
              <summary>
                Session history · {session.turns.length} messages
              </summary>
              {session.turns.length ? (
                session.turns.map((t, i) => (
                  <article key={i}>
                    <strong>
                      {t.role === "user" ? "You" : "Steward · AI"}
                    </strong>
                    <p>{t.content}</p>
                  </article>
                ))
              ) : (
                <p>
                  No messages yet. Direct edits stay in your planning draft.
                </p>
              )}
              {session.tools.length > 0 && (
                <p>Tools completed: {session.tools.join(" → ")}</p>
              )}
            </details>
          )}
          <p className="ps-privacy">
            Messages and relevant financial context are sent to OpenAI when you
            use AI. Steward calculates the numbers.{" "}
            {loaded ? "Draft resumes in this tab." : ""}
          </p>
          <button className="ps-text-button" disabled={busy} onClick={cancel}>
            {onCancel ? "Cancel session" : "Discard draft and start over"}
          </button>
        </section>
        <aside className="ps-summary">
          <span className="ps-eyebrow">
            {stageIndex === 0
              ? "Your starting snapshot"
              : session.stage === "review"
                ? "Ready for your approval"
                : "Your evolving plan"}
          </span>
          <h2>
            {stageIndex === 0
              ? "Clarity starts here."
              : "Room for what matters."}
          </h2>
          <div className="ps-summary-amount">
            <small>Projected income per paycheck</small>
            <strong>{money(preview.profile.takeHomePay)}</strong>
            <span>
              {preview.profile.payFrequency} ·{" "}
              {preview.profile.nextPayday || "Payday needed"}
            </span>
          </div>
          <dl>
            <div>
              <dt>Bills & reserves</dt>
              <dd>{money(plan?.reservesTotal ?? 0)}</dd>
            </div>
            <div>
              <dt>Everyday spending</dt>
              <dd>{money(plan?.spendTotal ?? 0)}</dd>
            </div>
            <div>
              <dt>Buffer top-up</dt>
              <dd>{money(plan?.bufferTopUp ?? 0)}</dd>
            </div>
            <div className="ps-summary-free">
              <dt>Capacity for priorities</dt>
              <dd>{money(plan?.freeCapacity ?? 0)}</dd>
            </div>
          </dl>
          {stageIndex > 1 && (
            <div className="ps-summary-goals">
              {proposal?.lines.map((l) => (
                <div key={l.claim.id}>
                  <span>{l.claim.name}</span>
                  <strong>{money(l.amount)}</strong>
                </div>
              ))}
              <div>
                <span>Unallocated</span>
                <strong>{money(unallocated)}</strong>
              </div>
              <small>Proposed contributions this paycheck</small>
            </div>
          )}
          <div className="ps-cash">
            <span>Today’s money is separate</span>
            <strong>
              {liquidity.known ? money(liquidity.cash) : "Balance not verified"}
            </strong>
            <p>
              {liquidity.known
                ? `${money(liquidity.available)} available after protected amounts.`
                : "Update balances before relying on a purchase decision."}
            </p>
            <small>
              {money(liquidity.earmarks)} already earmarked for goals.
            </small>
          </div>
          <div className="ps-summary-checks">
            {groups.map((g) => (
              <span key={g}>
                {session.confirmed.includes(g) ? (
                  <Check size={14} />
                ) : (
                  <span className="ps-dot" />
                )}
                {g === "income"
                  ? "Income & timing"
                  : g === "bills"
                    ? "Bills & minimums"
                    : "Spending"}{" "}
                · {session.confirmed.includes(g) ? "confirmed" : "to review"}
              </span>
            ))}
          </div>
        </aside>
      </div>
    </main>
  );
}

function IncomeFacts({
  workspace,
  onSave,
}: {
  workspace: Workspace;
  onSave: (w: Workspace) => void;
}) {
  return (
    <form
      className="ps-facts"
      onSubmit={(e) => {
        e.preventDefault();
        const d = new FormData(e.currentTarget);
        onSave({
          ...workspace,
          profile: {
            ...workspace.profile,
            takeHomePay: Number(d.get("income")),
            nextPayday: String(d.get("payday")),
            payFrequency: String(
              d.get("frequency"),
            ) as Workspace["profile"]["payFrequency"],
          },
        });
      }}
    >
      <label>
        Take-home pay per paycheck
        <input
          name="income"
          type="number"
          min="0.01"
          max="10000000"
          step="0.01"
          defaultValue={workspace.profile.takeHomePay || ""}
          required
        />
      </label>
      <label>
        Next payday
        <input
          name="payday"
          type="date"
          defaultValue={workspace.profile.nextPayday}
          required
        />
      </label>
      <label>
        Pay rhythm
        <select name="frequency" defaultValue={workspace.profile.payFrequency}>
          {["Weekly", "Biweekly", "Monthly"].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <button type="submit">Save corrections</button>
      <p className="ps-muted">
        Income is projected. It is not added to your current bank balance.
      </p>
    </form>
  );
}
function BucketFacts({
  workspace,
  group,
  onSave,
}: {
  workspace: Workspace;
  group: "bills" | "spending";
  onSave: (w: Workspace) => void;
}) {
  const bills = group === "bills";
  return (
    <div className="ps-bucket-facts">
      {workspace.buckets
        .filter((b) => b.kind === (bills ? "reserve" : "spend"))
        .map((b) => (
          <details key={b.id}>
            <summary>
              <span>
                {b.name}
                <small>
                  {bills
                    ? `Full bill · ${b.frequency ?? "cadence needed"} · due ${b.dueDate ?? "date needed"}`
                    : "Allowance per paycheck"}
                </small>
              </span>
              <strong>{money((bills ? b.amountDue : b.perCycle) ?? 0)}</strong>
            </summary>
            <form
              className="ps-facts"
              onSubmit={(e) => {
                e.preventDefault();
                const d = new FormData(e.currentTarget);
                onSave({
                  ...workspace,
                  buckets: workspace.buckets.map((x) =>
                    x.id === b.id
                      ? {
                          ...x,
                          ...(bills
                            ? {
                                amountDue: Number(d.get("amount")),
                                dueDate: String(d.get("date")),
                                reserved: Number(d.get("reserved")),
                                frequency: String(
                                  d.get("frequency"),
                                ) as Bucket["frequency"],
                              }
                            : { perCycle: Number(d.get("amount")) }),
                        }
                      : x,
                  ),
                });
              }}
            >
              <label>
                {bills ? "Full bill amount" : "Per-paycheck allowance"}
                <input
                  name="amount"
                  type="number"
                  min="0"
                  max="10000000"
                  step="0.01"
                  defaultValue={(bills ? b.amountDue : b.perCycle) ?? 0}
                  required
                />
              </label>
              {bills && (
                <>
                  <label>
                    Due date
                    <input
                      name="date"
                      type="date"
                      defaultValue={b.dueDate}
                      required
                    />
                  </label>
                  <label>
                    Already reserved
                    <input
                      name="reserved"
                      type="number"
                      min="0"
                      step="0.01"
                      defaultValue={b.reserved ?? 0}
                      required
                    />
                  </label>
                  <label>
                    Frequency
                    <select
                      name="frequency"
                      defaultValue={b.frequency ?? "monthly"}
                    >
                      {[
                        "monthly",
                        "weekly",
                        "biweekly",
                        "annual",
                        "one-time",
                      ].map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <button>Save {b.name}</button>
            </form>
          </details>
        ))}
      <details>
        <summary>Add {bills ? "a bill" : "a spending category"}</summary>
        <form
          className="ps-facts"
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            const b: Bucket = {
              id: "bucket:manual:" + crypto.randomUUID(),
              name: String(d.get("name")),
              kind: bills ? "reserve" : "spend",
              essential: bills,
              source: "manual",
              ...(bills
                ? {
                    amountDue: Number(d.get("amount")),
                    dueDate: String(d.get("date")),
                    frequency: "monthly",
                    reserved: 0,
                  }
                : {
                    perCycle: Number(d.get("amount")),
                    category: String(d.get("name")),
                  }),
            };
            onSave({ ...workspace, buckets: [...workspace.buckets, b] });
          }}
        >
          <label>
            Name
            <input name="name" required maxLength={100} />
          </label>
          <label>
            {bills ? "Full monthly bill" : "Allowance per paycheck"}
            <input name="amount" type="number" min="0" step="0.01" required />
          </label>
          {bills && (
            <label>
              Next due date
              <input name="date" type="date" required />
            </label>
          )}
          <button>Add to draft</button>
        </form>
      </details>
      {!workspace.buckets.some(
        (b) => b.kind === (bills ? "reserve" : "spend"),
      ) && (
        <p className="ps-muted">
          Nothing listed yet. Add what you know, or explicitly confirm this
          group is empty.
        </p>
      )}
    </div>
  );
}
function GoalEditor({
  draft,
  workspace,
  onSave,
  initial,
}: {
  initial: string;
  draft: ChatDraft;
  workspace: Workspace;
  onSave: (d: ChatDraft, evidence: string) => void;
}) {
  const [selected, setSelected] = useState(initial);
  const choices = [
    ...draft.goals,
    ...workspace.claims
      .filter(
        (c) =>
          c.status === "active" &&
          !draft.goals.some(
            (g) =>
              g.id === c.id ||
              `claim:chat:${g.id}` === c.id ||
              g.name.toLowerCase() === c.name.toLowerCase(),
          ),
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        kind:
          c.kind === "payoff"
            ? ("payoff" as const)
            : c.kind === "purchase"
              ? ("purchase" as const)
              : ("fund" as const),
        amount: c.openEnded ? null : c.targetAmount,
        contribution: c.pinned ?? null,
        date: c.wantBy ?? null,
        accountId: c.linkedAccountId ?? null,
        evidence: "",
      })),
  ];
  const existing = choices.find((g) => g.id === selected);
  return (
    <div className="ps-manual">
      <label>
        Priority to edit
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="new">New priority</option>
          {choices.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <form
        key={selected}
        className="ps-facts"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          const kind = String(d.get("kind")) as "fund" | "purchase" | "payoff";
          const evidence = `Set ${d.get("name")} with target ${d.get("amount") || "open-ended"}, contribution ${d.get("contribution") || "by priority"}, deadline ${d.get("date") || "none"}.`;
          const goal = {
            id: existing?.id ?? crypto.randomUUID(),
            name: String(d.get("name")),
            kind,
            amount: d.get("amount") ? Number(d.get("amount")) : null,
            contribution: d.get("contribution")
              ? Number(d.get("contribution"))
              : null,
            date: String(d.get("date")) || null,
            accountId: kind === "payoff" ? String(d.get("account")) : null,
            evidence,
          };
          const goals = draft.goals.filter((g) => g.id !== goal.id);
          goals.splice(Number(d.get("rank")), 0, goal);
          onSave({ ...draft, goals, purchase: null }, evidence);
        }}
      >
        <label>
          Name
          <input
            name="name"
            maxLength={100}
            defaultValue={existing?.name}
            required
          />
        </label>
        <label>
          Purpose
          <select name="kind" defaultValue={existing?.kind ?? "fund"}>
            <option value="fund">Savings cushion or fund</option>
            <option value="purchase">Purchase</option>
            <option value="payoff">Optional extra debt repayment</option>
          </select>
        </label>
        <label>
          Priority order
          <select
            name="rank"
            defaultValue={
              existing
                ? Math.max(
                    0,
                    draft.goals.findIndex((g) => g.id === existing.id),
                  )
                : draft.goals.length
            }
          >
            {Array.from(
              {
                length: Math.max(
                  1,
                  draft.goals.some((g) => g.id === selected)
                    ? draft.goals.length
                    : draft.goals.length + 1,
                ),
              },
              (_, i) => (
                <option key={i} value={i}>
                  {i + 1}
                  {i === 0 ? " · first" : ""}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Target · blank for open-ended savings
          <input
            name="amount"
            type="number"
            min="0.01"
            max="10000000"
            step="0.01"
            defaultValue={existing?.amount ?? ""}
          />
        </label>
        <label>
          Contribution per paycheck · blank for priority order
          <input
            name="contribution"
            type="number"
            min="0"
            max="10000000"
            step="0.01"
            defaultValue={existing?.contribution ?? ""}
          />
        </label>
        <label>
          Wanted by · optional
          <input name="date" type="date" defaultValue={existing?.date ?? ""} />
        </label>
        <label>
          Debt account · only for extra repayment
          <select name="account" defaultValue={existing?.accountId ?? ""}>
            <option value="">Choose debt if applicable</option>
            {workspace.claims
              .filter((c) => c.kind === "payoff")
              .map((c) => (
                <option key={c.id} value={c.linkedAccountId}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
        <button className="ps-primary">Preview priority</button>
      </form>
      {existing && draft.goals.some((g) => g.id === existing.id) && (
        <button
          onClick={() =>
            onSave(
              {
                ...draft,
                goals: draft.goals.filter((g) => g.id !== existing.id),
              },
              `Remove ${existing.name} from the proposed priorities.`,
            )
          }
        >
          Remove proposed priority
        </button>
      )}
    </div>
  );
}
function ManualPurchase({
  workspace,
  today,
  onResult,
}: {
  workspace: Workspace;
  today: string;
  onResult: (v: Verdict | null) => void;
}) {
  return (
    <details className="ps-manual">
      <summary>Check a purchase manually</summary>
      <form
        className="ps-facts"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          onResult(
            evaluatePurchase(workspace, today, {
              item: String(d.get("item")),
              price: Number(d.get("price")),
            }),
          );
        }}
      >
        <label>
          Purchase or category
          <input name="item" maxLength={100} required />
        </label>
        <label>
          Price
          <input
            name="price"
            type="number"
            min="0.01"
            max="10000000"
            step="0.01"
            required
          />
        </label>
        <button>Calculate purchase check</button>
      </form>
    </details>
  );
}
