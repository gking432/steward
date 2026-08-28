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

const PHASES: OnboardingPhase[] = ["goals", "review", "strategy", "budget", "checkin"];
const PHASE_LABELS: Record<OnboardingPhase, string> = {
  goals: "Goals",
  review: "Money",
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
  const [phase, setPhase] = useState<OnboardingPhase>("goals");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);
  const inFlightRef = useRef(false);
  const stateRef = useRef(state);
  const turnsRef = useRef<OnboardingTurn[]>([]);
  const replyIdRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
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

      const nextPreview = previewAIOnboarding(workspace, today, payload.state);
      const plan = payload.showPlan
        ? buildPlanView(workspace, nextPreview, today, payload.state) ?? undefined
        : undefined;
      const assistantTurn: OnboardingTurn = { role: "assistant", content: payload.message };
      const nextTurns = [...conversation, assistantTurn];
      turnsRef.current = nextTurns;
      stateRef.current = payload.state;
      replyIdRef.current += 1;
      setTurns(nextTurns);
      setState(payload.state);
      setPhase(payload.phase);
      setQuickReplies(payload.quickReplies ?? []);
      setActiveReply({ id: replyIdRef.current, message: payload.message, plan });
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
  }, [context, today, workspace]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void runTurn();
  }, [runTurn]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: turns.length > 1 ? "smooth" : "auto", block: "end" });
  }, [turns, busy, quickReplies]);

  useEffect(() => {
    if (typed || !answerInputRef.current) return;
    answerInputRef.current.scrollLeft = 0;
    answerInputRef.current.scrollTop = 0;
  }, [typed]);

  const complete = state.complete;
  const displayPhase = phase === "complete" ? "checkin" : phase;
  const phaseIndex = Math.max(0, PHASES.indexOf(displayPhase));
  const currentMessage = activeReply?.message ?? "";
  const merchantChoices = quickReplies.length > 0 && quickReplies.every((reply) =>
    context.recurringCharges.some((charge) => charge.merchant === reply));
  const showRecurring = phase === "review" && state.incomeConfirmed === true &&
    !state.recurringReviewed && context.recurringCharges.length > 0;
  const priorityStep = phase === "goals" && state.goals.length > 1 &&
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

  const submitPriority = () => submit(
    `Priority order: ${state.goals.map((goal) => goal.name).join(", then ")}.`,
  );

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
          {livePlan && <MoneyMap plan={livePlan} state={state} busy={busy} />}
        </aside>

        <section className="ik-conversation" aria-label="Conversation with Steward">
          {livePlan && (
            <details className="ik-plan-mobile">
              <summary><span><WalletCards size={15} /> Plan taking shape</span><b>{formatMoney(livePlan.income)} / paycheck</b></summary>
              <MoneyMap plan={livePlan} state={state} busy={busy} compact />
            </details>
          )}

          <div className="ik-thread" aria-live="polite">
            <div className="ik-intro">
              <span><Sparkles size={18} /></span>
              <div><b>Let’s build your first plan.</b><p>I’ve already read the demo finances. Tell me what you want your money to do.</p></div>
            </div>

            {turns.map((turn, index) => {
              const isLatest = index === turns.length - 1;
              return (
                <div key={`${turn.role}:${index}`} className={`ik-turn ${turn.role}`}>
                  {turn.role === "assistant" && <span className="ik-avatar"><Sparkles size={13} /></span>}
                  <div className="ik-turn-body">
                    <p>{turn.role === "user" ? displayUserAnswer(turn.content) : turn.content}</p>
                    {isLatest && turn.role === "assistant" && !busy && (
                      <>
                        {phase === "review" && state.incomeConfirmed !== true && <IncomeCard context={context} />}
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
            <div ref={endRef} />
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
                  placeholder={selectedReplies.length ? "Include more context?" : "Message Steward"}
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

function MoneyMap({ plan, state, busy, compact = false }: { plan: PlanView; state: AIOnboardingState; busy: boolean; compact?: boolean }) {
  const protectedTotal = plan.buckets.reduce((sum, row) => sum + row.amount, 0);
  const goalRows = state.goals.map((goal) => plan.claims.find((row) =>
    goal.linkedAccountId ? row.linkedAccountId === goal.linkedAccountId : row.name.toLowerCase() === goal.name.toLowerCase()));
  const goalTotal = goalRows.reduce((sum, row) => sum + (row?.amount ?? 0), 0);
  const free = Math.max(0, plan.income - protectedTotal - goalTotal);
  return (
    <section className={`ik-money-map${compact ? " compact" : ""}${busy ? " updating" : ""}`}>
      <header><span><i /> Your plan</span><b>{busy ? "Updating" : "Live"}</b></header>
      <div className="ik-paycheck"><small>This paycheck</small><strong>{formatMoney(plan.income)}</strong></div>
      <div className="ik-allocation-bar">
        <i className="required" style={{ flexGrow: Math.max(protectedTotal, 1) }} />
        <i className="goals" style={{ flexGrow: Math.max(goalTotal, 1) }} />
        <i className="free" style={{ flexGrow: Math.max(free, 1) }} />
      </div>
      <div className="ik-money-lines">
        <span><i className="required" /><b>Required + everyday</b><strong>{formatMoney(protectedTotal)}</strong></span>
        {state.goals.slice(0, 4).map((goal, index) => (
          <span key={goal.id}><i className="goals" /><b>{goal.name}</b><strong>{goalRows[index]?.amount ? `+${formatMoney(goalRows[index]!.amount)}` : "Planning"}</strong></span>
        ))}
        <span className="free"><i /><b>Free to direct</b><strong>{formatMoney(free)}</strong></span>
      </div>
      {state.goals.length === 0
        ? <p>Your goals will appear here as Steward understands them.</p>
        : <p>Every answer updates what this paycheck can do.</p>}
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
  return (
    <section className="ik-budget-card">
      <header><span><Target size={16} /> Proposed paycheck plan</span><b>{formatMoney(plan.income)}</b></header>
      <div>
        {plan.buckets.slice(0, 6).map((row) => <span key={row.name}><b>{row.name}</b><strong>{formatMoney(row.amount)}</strong></span>)}
        {plan.claims.slice(0, 4).map((row) => <span key={row.id} className="goal"><b>{row.name}</b><strong>+{formatMoney(row.amount)}</strong></span>)}
      </div>
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
