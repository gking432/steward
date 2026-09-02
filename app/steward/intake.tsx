"use client";

/**
 * FIRST RUN — a model-led conversation with a live financial plan beside it.
 *
 * The model owns the dialogue. The product renders useful controls and the
 * financial consequences without turning the conversation into a form.
 */

import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Dumbbell,
  Landmark,
  LoaderCircle,
  ReceiptText,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allocate, formatMoney, planCycle } from "../../lib/model/engine";
import {
  EMPTY_AI_ONBOARDING_STATE,
  acceptAIOnboarding,
  acceptedCancellationStrategies,
  buildAIOnboardingContext,
  irregularSpendingPerPaycheck,
  onboardingReplySubmitsImmediately,
  previewAIOnboarding,
  type AIOnboardingContext,
  type AIOnboardingState,
  type OnboardingPhase,
  type OnboardingStrategy,
  type OnboardingTurn,
} from "../../lib/model/onboarding-ai";
import type { Workspace } from "../../lib/model/types";
import "./intake.css";

type PlanView = {
  income: number;
  buckets: { name: string; amount: number }[];
  claims: { id: string; name: string; amount: number; linkedAccountId: string | null }[];
  free: number;
  savings: { merchant: string; yearly: number }[];
};

type ActiveReply = {
  id: number;
  message: string;
  plan?: PlanView;
};

type OnboardingResponse = {
  enhanced: boolean;
  message: string;
  quickReplies: string[];
  showPlan: boolean;
  phase: OnboardingPhase;
  state: AIOnboardingState;
};

const PHASES: OnboardingPhase[] = ["income", "spending", "recurring", "goals", "strategy", "budget", "checkin"];
const PHASE_LABELS: Record<OnboardingPhase, string> = {
  income: "Income",
  spending: "Spending",
  recurring: "Recurring",
  goals: "Goals",
  strategy: "Tradeoffs",
  budget: "Plan",
  checkin: "Rhythm",
  complete: "Ready",
};

function buildPlanView(
  original: Workspace,
  preview: Workspace,
  today: string,
  state: AIOnboardingState,
): PlanView | null {
  const plan = planCycle(preview, today);
  if (!plan) return null;
  const ranked = allocate(preview, plan.freeCapacity, today);
  return {
    income: plan.income,
    buckets: [
      ...plan.reserves.map((entry) => ({ name: entry.bucket.name, amount: entry.required })),
      ...plan.spend.map((entry) => ({ name: entry.bucket.name, amount: entry.amount })),
    ],
    claims: ranked.allocations
      .filter((line) => line.amount > 0)
      .map((line) => ({
        id: line.claim.id,
        name: line.claim.name,
        amount: line.amount,
        linkedAccountId: line.claim.linkedAccountId ?? null,
      })),
    free: plan.freeCapacity,
    savings: acceptedCancellationStrategies(original, today, state).map((strategy) => ({
      merchant: strategy.label.replace(/^Cancel /, ""),
      yearly: strategy.yearlySavings,
    })),
  };
}

export function IntakeScreen({
  workspace,
  today,
  scanComplete,
  demoMode = false,
  onDone,
}: {
  workspace: Workspace;
  today: string;
  scanComplete: boolean;
  demoMode?: boolean;
  onDone: (next: Workspace) => void;
}) {
  const [state, setState] = useState<AIOnboardingState>(EMPTY_AI_ONBOARDING_STATE);
  const [turns, setTurns] = useState<OnboardingTurn[]>([]);
  const [activeReply, setActiveReply] = useState<ActiveReply | null>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [selectedReplies, setSelectedReplies] = useState<string[]>([]);
  const [phase, setPhase] = useState<OnboardingPhase>("income");
  const [visibleTurnStart, setVisibleTurnStart] = useState(0);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);
  const inFlightRef = useRef(false);
  const stateRef = useRef(state);
  const turnsRef = useRef<OnboardingTurn[]>([]);
  const replyIdRef = useRef(0);
  const phaseRef = useRef<OnboardingPhase>("income");
  const handoffRef = useRef(false);
  const handoffTimerRef = useRef<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const answerInputRef = useRef<HTMLTextAreaElement>(null);

  const context = useMemo(
    () => buildAIOnboardingContext(workspace, today, scanComplete),
    [workspace, today, scanComplete],
  );
  const preview = useMemo(
    () => previewAIOnboarding(workspace, today, state),
    [workspace, today, state],
  );
  const livePlan = useMemo(
    () => buildPlanView(workspace, preview, today, state),
    [workspace, preview, today, state],
  );

  const runTurn = useCallback(async (userText?: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const said = userText?.trim();
    const conversation: OnboardingTurn[] = said
      ? [...turnsRef.current, { role: "user", content: said }]
      : turnsRef.current;

    if (said) {
      turnsRef.current = conversation;
      setTurns(conversation);
    }
    setTyped("");
    setQuickReplies([]);
    setSelectedReplies([]);
    setBusy(true);

    try {
      let payload: OnboardingResponse | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch("/api/steward-ai", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "onboarding",
            context,
            conversation,
            state: stateRef.current,
          }),
        });
        if (!response.ok) continue;
        payload = await response.json() as OnboardingResponse;
        if (payload.enhanced || attempt === 1) break;
      }
      if (!payload?.message || !payload.state) throw new Error("Invalid onboarding response");

      const priorPhase = phaseRef.current;
      const cadenceJustChosen = priorPhase === "checkin" && Boolean(payload.state.checkInCadence);
      const finalState = cadenceJustChosen && !payload.state.complete
        ? { ...payload.state, complete: true }
        : payload.state;
      const nextPreview = previewAIOnboarding(workspace, today, finalState);
      const plan = payload.showPlan
        ? buildPlanView(workspace, nextPreview, today, finalState) ?? undefined
        : undefined;
      const assistantTurn: OnboardingTurn = { role: "assistant", content: payload.message };
      const nextTurns = [...conversation, assistantTurn];
      const enteringStage = (
        payload.phase === "goals" || payload.phase === "budget" || payload.phase === "checkin"
      ) && phaseRef.current !== payload.phase;
      turnsRef.current = nextTurns;
      stateRef.current = finalState;
      phaseRef.current = finalState.complete ? "complete" : payload.phase;
      replyIdRef.current += 1;
      setTurns(nextTurns);
      if (enteringStage) setVisibleTurnStart(conversation.length);
      setState(finalState);
      setPhase(finalState.complete ? "complete" : payload.phase);
      setQuickReplies(payload.quickReplies ?? []);
      setActiveReply({ id: replyIdRef.current, message: payload.message, plan });
      if (finalState.complete && !handoffRef.current) {
        handoffRef.current = true;
        handoffTimerRef.current = window.setTimeout(() => {
          onDone(acceptAIOnboarding(workspace, today, finalState));
        }, 700);
      }
    } catch {
      const assistantTurn: OnboardingTurn = {
        role: "assistant",
        content: "I lost that for a moment. Tell me what you meant in your own words.",
      };
      turnsRef.current = [...conversation, assistantTurn];
      setTurns(turnsRef.current);
      setQuickReplies([]);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [context, onDone, today, workspace]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runTurn();
  }, [runTurn]);

  useEffect(() => () => {
    if (handoffTimerRef.current !== null) window.clearTimeout(handoffTimerRef.current);
  }, []);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    thread.scrollTo({
      top: thread.scrollHeight,
      behavior: turns.length > 1 ? "smooth" : "auto",
    });
  }, [turns, busy, quickReplies]);

  useEffect(() => {
    if (typed || !answerInputRef.current) return;
    answerInputRef.current.scrollLeft = 0;
    answerInputRef.current.scrollTop = 0;
  }, [typed]);

  useEffect(() => {
    if (busy || !/^what amount would you like to use/i.test(activeReply?.message ?? "")) return;
    answerInputRef.current?.focus();
  }, [activeReply, busy]);

  const complete = state.complete;
  const visibleTurns = turns.slice(visibleTurnStart);
  const displayPhase = phase === "complete" ? "checkin" : phase;
  const phaseIndex = Math.max(0, PHASES.indexOf(displayPhase));
  const currentMessage = activeReply?.message ?? "";
  const amountPrompt = /^what amount would you like to use/i.test(currentMessage);
  const merchantChoices = quickReplies.length > 0 && quickReplies.every((reply) =>
    context.recurringCharges.some((charge) => charge.merchant === reply));
  const showRecurring = phase === "recurring" && !state.recurringReviewed && context.recurringCharges.length > 0;
  const activeSpending = phase === "spending"
    ? context.monthlySpending.find((entry) => currentMessage.toLowerCase().includes(entry.category.toLowerCase()))
    : undefined;
  const priorityStep = phase === "goals" && !state.prioritiesConfirmed && state.goals.length > 1 &&
    /priority|priorities|matters most|put.+order/i.test(currentMessage);
  const activeStrategy = phase === "strategy"
    ? findActiveStrategy(context, state, currentMessage)
    : undefined;

  const submit = (text: string) => {
    if (!text.trim() || busy || complete) return;
    void runTurn(text);
  };

  const submitAnswer = () => {
    const extra = typed.trim();
    const selected = selectedReplies.join(", ");
    const answer = selected && extra
      ? `Selected: ${selected}. More context: ${extra}`
      : selected
        ? `Selected: ${selected}.`
        : extra;
    submit(answer);
  };

  const toggleReply = (reply: string) => {
    if (onboardingReplySubmitsImmediately(reply)) {
      submit(`Selected: ${reply}.`);
      return;
    }
    setSelectedReplies((current) => current.includes(reply)
      ? current.filter((entry) => entry !== reply)
      : [...current, reply]);
  };

  const moveGoal = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= stateRef.current.goals.length) return;
    const goals = [...stateRef.current.goals];
    [goals[index], goals[destination]] = [goals[destination], goals[index]];
    const next = { ...stateRef.current, goals };
    stateRef.current = next;
    setState(next);
  };

  const submitPriority = () => {
    const next = {
      ...stateRef.current,
      goals: [...state.goals],
      goalCollectionComplete: true,
      prioritiesConfirmed: true,
    };
    stateRef.current = next;
    setState(next);
    submit(`Priority order: ${next.goals.map((goal) => goal.name).join(", then ")}.`);
  };

  return (
    <main className="ik-shell">
      <header className="ik-topbar">
        <div className="ik-brand"><span><Sparkles size={15} /></span><b>Steward</b>{demoMode && <i>Demo</i>}</div>
        <div className="ik-stage-status">
          <span>{PHASE_LABELS[phase]}</span>
          <div>{PHASES.map((entry, index) => <i key={entry} className={index <= phaseIndex ? "active" : ""} />)}</div>
        </div>
      </header>

      <div className="ik-layout">
        <aside className="ik-plan-desktop">
          <MoneyMap plan={livePlan} context={context} state={state} busy={busy} />
        </aside>

        <section className="ik-conversation" aria-label="Conversation with Steward">
          <details className="ik-plan-mobile">
            <summary><span><WalletCards size={15} /> Buckets taking shape</span><b>{state.incomeConfirmed ? `${formatMoney(context.paycheck.amount)} / paycheck` : "Starting empty"}</b></summary>
            <MoneyMap plan={livePlan} context={context} state={state} busy={busy} compact />
          </details>

          <div ref={threadRef} className="ik-thread" aria-live="polite">
            <div className="ik-intro">
              <span><Sparkles size={18} /></span>
              {phase === "goals"
                ? <div><b>Now let’s talk about your goals.</b><p>Your income and baseline buckets are mapped. Next we’ll decide what the remaining money should accomplish.</p></div>
                : phase === "budget"
                  ? <div><b>Here’s your budget breakdown.</b><p>Every dollar from a normal paycheck now has a clear job.</p></div>
                  : phase === "checkin" || phase === "complete"
                    ? <div><b>I’ll keep you on track.</b><p>Steward watches the buckets, flags unusual spending, and stays ready when you have a question.</p></div>
                    : <div><b>Let’s build your first plan.</b><p>I read the demo statements. We’ll confirm what’s real, build the buckets, then decide what your money should do.</p></div>}
            </div>

            {visibleTurns.map((turn, index) => {
              const isLatest = index === visibleTurns.length - 1;
              return (
                <div key={`${turn.role}:${visibleTurnStart + index}`} className={`ik-turn ${turn.role}`}>
                  {turn.role === "assistant" && <span className="ik-avatar"><Sparkles size={13} /></span>}
                  <div className="ik-turn-body">
                    <p>{turn.role === "user" ? displayUserAnswer(turn.content) : turn.content}</p>
                    {isLatest && turn.role === "assistant" && !busy && (
                      <>
                        {phase === "income" && state.incomeConfirmed !== true && <IncomeCard context={context} />}
                        {activeSpending && <SpendingCard spending={activeSpending} />}
                        {showRecurring && (
                          <RecurringCard
                            charges={context.recurringCharges}
                            selectable={merchantChoices}
                            selected={selectedReplies}
                            onToggle={toggleReply}
                          />
                        )}
                        {phase === "strategy" && activeStrategy && <StrategyCard strategy={activeStrategy} context={context} />}
                        {priorityStep && <PriorityEditor goals={state.goals} onMove={moveGoal} onSubmit={submitPriority} />}
                        {activeReply?.plan && <BudgetCard plan={activeReply.plan} />}
                        {complete && <ReadyCard state={state} plan={livePlan} />}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {busy && (
              <div className="ik-turn assistant">
                <span className="ik-avatar"><Sparkles size={13} /></span>
                <div className="ik-thinking"><i /><i /><i /></div>
              </div>
            )}
          </div>

          {!complete && !priorityStep && (
            <footer className="ik-compose-area">
              {!busy && quickReplies.length > 0 && !merchantChoices && (
                <div className="ik-suggestions" aria-label="Suggested replies">
                  {quickReplies.map((reply) => {
                    const selected = selectedReplies.includes(reply);
                    return (
                      <button key={reply} type="button" className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => toggleReply(reply)}>
                        {selected && <Check size={13} />}{reply}
                      </button>
                    );
                  })}
                </div>
              )}
              <form className="ik-composer" onSubmit={(event) => { event.preventDefault(); submitAnswer(); }}>
                <textarea
                  ref={answerInputRef}
                  value={typed}
                  rows={1}
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitAnswer();
                    }
                  }}
                  placeholder={amountPrompt ? "Enter amount" : selectedReplies.length ? "Include more context?" : "Message Steward"}
                  inputMode={amountPrompt ? "decimal" : "text"}
                  aria-label="Message Steward"
                  disabled={busy}
                />
                <button type="submit" disabled={busy || (!typed.trim() && selectedReplies.length === 0)} aria-label="Send message">
                  {busy ? <LoaderCircle size={18} /> : <Send size={18} />}
                </button>
              </form>
              <small>Select as many as you want, add context if useful, then send.</small>
            </footer>
          )}

          {complete && (
            <footer className="ik-complete-action">
              <button onClick={() => onDone(acceptAIOnboarding(workspace, today, state))}>
                Start this paycheck <ArrowRight size={18} />
              </button>
            </footer>
          )}
        </section>
      </div>
    </main>
  );
}

function displayUserAnswer(content: string) {
  return content
    .replace(/^Selected:\s*/i, "")
    .replace(/\.\s*More context:\s*/i, " — ")
    .replace(/\.\s*$/, "");
}

function MoneyMap({ plan, context, state, busy, compact = false }: { plan: PlanView | null; context: AIOnboardingContext; state: AIOnboardingState; busy: boolean; compact?: boolean }) {
  const income = state.incomeConfirmed ? context.paycheck.amount : 0;
  const spendingRows = state.spendingReviews.flatMap((review) => {
    if (review.allocationPerPaycheck === null || review.allocationPerPaycheck <= 0) return [];
    const observed = context.monthlySpending.find((entry) => entry.id === review.id);
    return observed ? [{ name: observed.category, amount: review.allocationPerPaycheck }] : [];
  });
  const recurringRows = state.recurringReviewed
    ? context.recurringCharges.map((charge) => ({ name: charge.merchant, amount: charge.perPaycheck }))
    : [];
  const miscellaneous = irregularSpendingPerPaycheck(context, state);
  const irregularRows = miscellaneous > 0
    ? [{ name: "Miscellaneous", amount: miscellaneous }]
    : [];
  const bucketRows = [...spendingRows, ...recurringRows, ...irregularRows];
  const protectedTotal = bucketRows.reduce((sum, row) => sum + row.amount, 0);
  const goalRows = state.goals.map((goal) => plan?.claims.find((row) =>
    goal.linkedAccountId ? row.linkedAccountId === goal.linkedAccountId : row.name.toLowerCase() === goal.name.toLowerCase()));
  const goalTotal = goalRows.reduce((sum, row) => sum + (row?.amount ?? 0), 0);
  const free = Math.max(0, income - protectedTotal - goalTotal);
  const totalDetected = context.monthlySpending.length + context.recurringCharges.length;
  const mappedCount = state.spendingReviews.filter((review) => review.allocationPerPaycheck !== null).length +
    (state.recurringReviewed ? context.recurringCharges.length : 0);
  return (
    <section className={`ik-money-map${compact ? " compact" : ""}${busy ? " updating" : ""}`}>
      <header><span><i /> Your buckets</span><b>{busy ? "Updating" : `${mappedCount}/${totalDetected} mapped`}</b></header>
      {state.incomeConfirmed ? <>
        <div className="ik-paycheck"><small>Confirmed income</small><strong>{formatMoney(income)}</strong><em>per paycheck</em></div>
        <div className="ik-allocation-bar">
          <i className="required" style={{ flexGrow: Math.max(protectedTotal, 1) }} />
          <i className="goals" style={{ flexGrow: Math.max(goalTotal, 1) }} />
          <i className="free" style={{ flexGrow: Math.max(free, 1) }} />
        </div>
      </> : <div className="ik-empty-plan"><Landmark size={19} /><b>Start with income</b><span>Buckets appear only after you confirm them.</span></div>}
      {state.incomeConfirmed && <div className="ik-money-lines">
        {bucketRows.map((row) => <span key={row.name}><i className="required" /><b>{row.name}</b><strong>{formatMoney(row.amount)}</strong></span>)}
        {state.goals.slice(0, 4).map((goal, index) => (
          <span key={goal.id}><i className="goals" /><b>{goal.name}</b><strong>{goalRows[index]?.amount ? `+${formatMoney(goalRows[index]!.amount)}` : "Planning"}</strong></span>
        ))}
        <span className="free"><i /><b>Unallocated</b><strong>{formatMoney(free)}</strong></span>
      </div>}
      <p>{state.incomeConfirmed ? "Each confirmed answer adds or updates a paycheck bucket." : "Nothing is assumed just because it appeared in a statement."}</p>
    </section>
  );
}

function SpendingCard({ spending }: { spending: AIOnboardingContext["monthlySpending"][number] }) {
  return (
    <section className="ik-inline-card ik-spending-card">
      <header><span className="ik-card-icon"><ReceiptText size={18} /></span><div><small>Past 90 days</small><b>{spending.category}</b></div><strong>{formatMoney(spending.amount)}<small>/ month</small></strong></header>
      <div><span>Seen at</span><b>{spending.merchants.join(" · ") || "Several merchants"}</b></div>
    </section>
  );
}

function IncomeCard({ context }: { context: AIOnboardingContext }) {
  return (
    <section className="ik-inline-card ik-income-card">
      <span className="ik-card-icon"><Landmark size={18} /></span>
      <div><small>Found in your statements</small><b>{context.paycheck.merchant ?? "Regular income"}</b><span>{friendlyCadence(context.paycheck.cadence)}</span></div>
      <strong>{formatMoney(context.paycheck.amount)}</strong>
    </section>
  );
}

const BRAND_MARKS: Record<string, string> = {
  Netflix: "https://cdn.simpleicons.org/netflix/E50914",
  Spotify: "https://cdn.simpleicons.org/spotify/1DB954",
};

function RecurringCard({
  charges,
  selectable,
  selected,
  onToggle,
}: {
  charges: AIOnboardingContext["recurringCharges"];
  selectable: boolean;
  selected: string[];
  onToggle: (merchant: string) => void;
}) {
  return (
    <section className="ik-recurring-card">
      <header><span><Sparkles size={13} /> Detected recurring</span><b>{charges.length} found</b></header>
      <div>
        {charges.map((charge) => {
          const chosen = selected.includes(charge.merchant);
          const body = (
            <>
              <span className={`ik-merchant-logo ${merchantTone(charge.merchant)}`}>
                {charge.merchant === "Midtown Fitness" ? <Dumbbell size={18} /> : charge.merchant.slice(0, 1)}
                {BRAND_MARKS[charge.merchant] && <img src={BRAND_MARKS[charge.merchant]} alt="" />}
              </span>
              <span><b>{charge.merchant}</b><small>{friendlyCadence(charge.cadence)}</small></span>
              <strong>{formatMoney(charge.amount)}</strong>
              {selectable && <i className={chosen ? "chosen" : ""}>{chosen && <Check size={12} />}</i>}
            </>
          );
          return selectable
            ? <button key={charge.id} type="button" aria-pressed={chosen} onClick={() => onToggle(charge.merchant)}>{body}</button>
            : <article key={charge.id}>{body}</article>;
        })}
      </div>
      <footer><ShieldCheck size={12} /> Matched from statement patterns</footer>
    </section>
  );
}

function PriorityEditor({ goals, onMove, onSubmit }: { goals: AIOnboardingState["goals"]; onMove: (index: number, direction: -1 | 1) => void; onSubmit: () => void }) {
  return (
    <section className="ik-priority-card">
      <small>Highest priority first</small>
      {goals.map((goal, index) => (
        <article key={goal.id}>
          <i>{index + 1}</i><b>{goal.name}</b>
          <span>
            <button type="button" disabled={index === 0} onClick={() => onMove(index, -1)} aria-label={`Move ${goal.name} up`}><ChevronUp size={15} /></button>
            <button type="button" disabled={index === goals.length - 1} onClick={() => onMove(index, 1)} aria-label={`Move ${goal.name} down`}><ChevronDown size={15} /></button>
          </span>
        </article>
      ))}
      <button type="button" className="ik-card-action" onClick={onSubmit}>Use this order <ArrowRight size={15} /></button>
    </section>
  );
}

function findActiveStrategy(context: AIOnboardingContext, state: AIOnboardingState, message: string) {
  const unavailable = new Set([...state.acceptedStrategyIds, ...state.declinedStrategyIds]);
  const available = context.strategies.filter((strategy) => !unavailable.has(strategy.id));
  const lower = message.toLowerCase();
  return available.find((strategy) => {
    const target = strategy.kind === "cut_bucket"
      ? context.currentBudget.buckets.find((bucket) => bucket.id === strategy.targetId)?.name
      : context.recurringCharges.find((charge) => charge.id === strategy.targetId)?.merchant;
    return Boolean(target && lower.includes(target.toLowerCase()));
  }) ?? available[0];
}

function StrategyCard({ strategy, context }: { strategy: OnboardingStrategy; context: AIOnboardingContext }) {
  const target = strategy.kind === "cut_bucket"
    ? context.currentBudget.buckets.find((bucket) => bucket.id === strategy.targetId)?.name ?? "Flexible spending"
    : context.recurringCharges.find((charge) => charge.id === strategy.targetId)?.merchant ?? "Subscription";
  return (
    <section className="ik-strategy-card">
      <header><span><CreditCard size={17} /></span><div><small>Possible move</small><b>{target}</b></div></header>
      <div><span><small>Now</small><b>{formatMoney(strategy.fromAmount)}</b></span><ArrowRight size={16} /><span><small>New</small><b>{formatMoney(strategy.toAmount)}</b></span></div>
      <footer>Frees <b>{formatMoney(strategy.freesPerPaycheck)}</b> each paycheck</footer>
    </section>
  );
}

function BudgetCard({ plan }: { plan: PlanView }) {
  const bucketTotal = plan.buckets.reduce((sum, row) => sum + row.amount, 0);
  const goalTotal = plan.claims.reduce((sum, row) => sum + row.amount, 0);
  const remaining = Math.max(0, plan.income - bucketTotal - goalTotal);
  return (
    <section className="ik-budget-card">
      <header><span><Target size={16} /> Your paycheck plan</span><b>{formatMoney(plan.income)}</b></header>
      <div className="ik-budget-overview">
        <span><small>Bills & spending</small><b>{formatMoney(bucketTotal)}</b></span>
        <span><small>Goals</small><b>{formatMoney(goalTotal)}</b></span>
        <span><small>Available</small><b>{formatMoney(remaining)}</b></span>
      </div>
      <div className="ik-budget-details">
        <small>Budget buckets</small>
        {plan.buckets.map((row) => <span key={row.name}><b>{row.name}</b><strong>{formatMoney(row.amount)}</strong></span>)}
        {plan.claims.length > 0 && <small>Goals, in priority order</small>}
        {plan.claims.map((row) => <span key={row.id} className="goal"><b>{row.name}</b><strong>+{formatMoney(row.amount)}</strong></span>)}
      </div>
      <footer><span>Still available this paycheck</span><b>{formatMoney(remaining)}</b></footer>
    </section>
  );
}

function ReadyCard({ state, plan }: { state: AIOnboardingState; plan: PlanView | null }) {
  const cadence = state.checkInCadence === "every_other_day" ? "Every other day" : state.checkInCadence === "daily" ? "Daily" : "Weekly";
  return (
    <section className="ik-ready-card">
      <span><CheckCircle2 size={25} /></span>
      <div><b>Your first plan is ready.</b><small>{state.goals.length} {state.goals.length === 1 ? "goal" : "goals"} prioritized · {cadence} check-ins</small></div>
      <strong>{plan ? formatMoney(Math.max(0, plan.free)) : "$0"}<small>free this paycheck</small></strong>
    </section>
  );
}

function friendlyCadence(cadence: string) {
  if (/biweekly|two weeks/i.test(cadence)) return "Every two weeks";
  if (/month/i.test(cadence)) return "Monthly";
  if (/week/i.test(cadence)) return "Weekly";
  return cadence;
}

function merchantTone(merchant: string) {
  if (merchant === "Netflix") return "netflix";
  if (merchant === "Spotify") return "spotify";
  return "fitness";
}
