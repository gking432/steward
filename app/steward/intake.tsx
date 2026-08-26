"use client";

/**
 * FIRST RUN — a staged, AI-directed financial setup.
 *
 * The model decides which single question matters next. The interface owns the
 * experience: each phase is a focused product screen, while deterministic code
 * remains the only layer allowed to change the budget.
 */

import {
  ArrowRight,
  BellRing,
  CalendarDays,
  CarFront,
  Check,
  CheckCircle2,
  CircleDollarSign,
  CreditCard,
  Dumbbell,
  House,
  Landmark,
  LoaderCircle,
  PiggyBank,
  Plane,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Target,
  Utensils,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
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
  claims: { name: string; amount: number }[];
  free: number;
  savings: { merchant: string; yearly: number }[];
};

type ActiveStep = {
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

const DISPLAY_PHASES = ["goals", "review", "strategy", "budget", "checkin"] as const;

const PHASE_LABELS: Record<(typeof DISPLAY_PHASES)[number], string> = {
  goals: "Goals",
  review: "Snapshot",
  strategy: "Choices",
  budget: "Plan",
  checkin: "Rhythm",
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
      .map((line) => ({ name: line.claim.name, amount: line.amount })),
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
  const [step, setStep] = useState<ActiveStep | null>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [selectedReplies, setSelectedReplies] = useState<string[]>([]);
  const [phase, setPhase] = useState<OnboardingPhase>("goals");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);
  const stateRef = useRef(state);
  const turnsRef = useRef<OnboardingTurn[]>([]);
  const inFlightRef = useRef(false);
  const stepIdRef = useRef(0);

  const context = useMemo(
    () => buildAIOnboardingContext(workspace, today, scanComplete),
    [workspace, today, scanComplete],
  );

  const runTurn = useCallback(async (userText?: string) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const said = userText?.trim();
    const conversation: OnboardingTurn[] = said
      ? [...turnsRef.current, { role: "user", content: said }]
      : turnsRef.current;

    if (said) turnsRef.current = conversation;
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

      const preview = previewAIOnboarding(workspace, today, payload.state);
      const plan = payload.showPlan
        ? buildPlanView(workspace, preview, today, payload.state) ?? undefined
        : undefined;
      const assistantTurn: OnboardingTurn = { role: "assistant", content: payload.message };
      turnsRef.current = [...conversation, assistantTurn];
      stateRef.current = payload.state;
      stepIdRef.current += 1;
      setState(payload.state);
      setPhase(payload.phase);
      setQuickReplies(payload.quickReplies ?? []);
      setStep({ id: stepIdRef.current, message: payload.message, plan });
    } catch {
      stepIdRef.current += 1;
      setStep({
        id: stepIdRef.current,
        message: "That didn’t land. Try that answer once more.",
      });
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

  const complete = state.complete;
  const displayPhase = phase === "complete" ? "checkin" : phase;
  const progressIndex = Math.max(0, DISPLAY_PHASES.indexOf(displayPhase));
  const stage = stageCopy(phase, state);
  const merchantChoices = quickReplies.length > 0 && quickReplies.every((reply) =>
    context.recurringCharges.some((charge) => charge.merchant === reply));
  const showRecurring = phase === "review" && state.incomeConfirmed === true &&
    !state.recurringReviewed && context.recurringCharges.length > 0;
  const activeStrategy = phase === "strategy"
    ? findActiveStrategy(context, state, step?.message ?? "")
    : undefined;

  const submit = (text: string) => {
    if (!text.trim() || busy || complete) return;
    void runTurn(text);
  };

  const submitAnswer = () => {
    const contextText = typed.trim();
    const selectedText = selectedReplies.join(", ");
    const answer = selectedText && contextText
      ? `Selected: ${selectedText}. More context: ${contextText}`
      : selectedText
        ? `Selected: ${selectedText}.`
        : contextText;
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

  return (
    <main className="ik-screen">
      <header className="ik-top">
        <span className="ik-brand">
          <span className="ik-brand-mark"><Sparkles size={14} /></span>
          <span>Steward{demoMode ? " · Demo" : ""}</span>
        </span>
        <span className="ik-phase-count">{Math.min(progressIndex + 1, 5)} of 5</span>
      </header>

      <nav className="ik-progress" aria-label={`Onboarding stage ${Math.min(progressIndex + 1, 5)} of 5`}>
        {DISPLAY_PHASES.map((entry, index) => (
          <span key={entry} className={index < progressIndex ? "done" : index === progressIndex ? "current" : ""}>
            <i />
            <b>{PHASE_LABELS[entry]}</b>
          </span>
        ))}
      </nav>

      <section className="ik-stage" key={`${phase}:${step?.id ?? 0}`}>
        <div className="ik-stage-heading">
          <span className="ik-eyebrow">{stage.eyebrow}</span>
          <h1>{stage.title}</h1>
          <p>{stage.description}</p>
        </div>

        <div className="ik-workspace" aria-live="polite">
          {phase === "goals" && state.goals.length > 0 && <GoalShelf state={state} />}
          {phase === "review" && state.incomeConfirmed !== true && <IncomeDiscovery context={context} />}
          {showRecurring && (
            <RecurringReviewCard
              charges={context.recurringCharges}
              selectable={merchantChoices}
              selected={selectedReplies}
              onToggle={toggleReply}
            />
          )}
          {phase === "strategy" && activeStrategy && (
            <StrategyCard strategy={activeStrategy} context={context} />
          )}
          {(phase === "budget" || phase === "complete") && step?.plan && <PlanCard plan={step.plan} />}
          {phase === "checkin" && !complete && <RhythmPreview />}
          {complete && <CompletionCard state={state} />}

          {!complete && (
            <div className={`ik-question${busy ? " is-loading" : ""}`}>
              {busy ? (
                <>
                  <span className="ik-thinking-orb"><LoaderCircle size={18} /></span>
                  <div><b>Steward is connecting the dots</b><small>Shaping the next useful step…</small></div>
                </>
              ) : (
                <>
                  <span className="ik-question-mark"><Sparkles size={15} /></span>
                  <p>{step?.message ?? "Getting your first question ready…"}</p>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      <footer className="ik-actions">
        {complete ? (
          <button className="ik-primary" onClick={() => onDone(acceptAIOnboarding(workspace, today, state))}>
            Open my budget <ArrowRight size={18} />
          </button>
        ) : (
          <>
            {!busy && quickReplies.length > 0 && !merchantChoices && (
              <ChoiceGrid
                replies={quickReplies}
                selected={selectedReplies}
                onToggle={toggleReply}
                compact={phase === "strategy" || phase === "review"}
              />
            )}
            {!busy && (
              <form className="ik-composer" onSubmit={(event) => { event.preventDefault(); submitAnswer(); }}>
                <label>
                  <span>{selectedReplies.length > 0 ? "Optional" : "Your answer"}</span>
                  <input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    placeholder={selectedReplies.length > 0 ? "Include more context?" : "Type something else…"}
                    aria-label="Your answer"
                  />
                </label>
                <button
                  type="submit"
                  disabled={!typed.trim() && selectedReplies.length === 0}
                  aria-label="Continue"
                >
                  <span>{selectedReplies.length > 0 ? "Continue" : "Send"}</span>
                  <ArrowRight size={17} />
                </button>
              </form>
            )}
          </>
        )}
      </footer>
    </main>
  );
}

function stageCopy(phase: OnboardingPhase, state: AIOnboardingState) {
  if (phase === "goals") return {
    eyebrow: "Stage one · Your priorities",
    title: state.goals.length ? "Build a plan around your life." : "What should your money make possible?",
    description: "Choose freely. Steward will ask only what it needs to turn each goal into a real plan.",
  };
  if (phase === "review") return state.incomeConfirmed === true ? {
    eyebrow: "Stage two · Your snapshot",
    title: "We found the shape of your month.",
    description: "Confirm what belongs, flag what doesn’t, and Steward will use the clean picture.",
  } : {
    eyebrow: "Stage two · Your snapshot",
    title: "Let’s confirm the money coming in.",
    description: "This is based on the deposits found in your connected statements.",
  };
  if (phase === "strategy") return {
    eyebrow: "Stage three · Your choices",
    title: "Make room without making life miserable.",
    description: "Steward tests one realistic tradeoff at a time. You stay in control.",
  };
  if (phase === "budget") return {
    eyebrow: "Stage four · Your plan",
    title: "Every paycheck has a job.",
    description: "Bills stay protected first. The rest moves toward the priorities you chose.",
  };
  if (phase === "complete") return {
    eyebrow: "Setup complete",
    title: "Your money has a direction now.",
    description: "Steward will keep the plan current as new spending arrives.",
  };
  return {
    eyebrow: "Stage five · Your rhythm",
    title: "Stay informed, not overwhelmed.",
    description: "Choose how often Steward should surface progress, changes, and useful nudges.",
  };
}

function GoalShelf({ state }: { state: AIOnboardingState }) {
  return (
    <section className="ik-goal-shelf" aria-label="Goals collected so far">
      <header><span>Your priorities</span><b>{state.goals.length} saved</b></header>
      <div>
        {state.goals.map((goal, index) => (
          <article key={goal.id}>
            <span className="ik-goal-rank">{index + 1}</span>
            <span><b>{goal.name}</b><small>{goal.targetAmount ? formatMoney(goal.targetAmount) : "We’ll size this together"}</small></span>
            {goal.detailsComplete && <CheckCircle2 size={18} />}
          </article>
        ))}
      </div>
    </section>
  );
}

function IncomeDiscovery({ context }: { context: AIOnboardingContext }) {
  return (
    <section className="ik-income-card" aria-label="Income Steward found">
      <span className="ik-discovery-tag"><Sparkles size={12} /> Found in your statements</span>
      <div className="ik-income-amount">
        <strong>{formatMoney(context.paycheck.amount)}</strong>
        <span>per paycheck</span>
      </div>
      <div className="ik-income-source">
        <span className="ik-source-icon"><Landmark size={19} /></span>
        <span><b>{context.paycheck.merchant ?? "Regular income"}</b><small>{friendlyCadence(context.paycheck.cadence)}</small></span>
        <ShieldCheck size={18} />
      </div>
    </section>
  );
}

const BRAND_MARKS: Record<string, string> = {
  Netflix: "https://cdn.simpleicons.org/netflix/E50914",
  Spotify: "https://cdn.simpleicons.org/spotify/1DB954",
};

function RecurringReviewCard({
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
  const yearlyTotal = charges.reduce((sum, charge) => sum + charge.yearlyCost, 0);
  return (
    <section className="ik-recurring" aria-label="Recurring charges Steward found">
      <header>
        <div><span className="ik-discovery-tag"><Sparkles size={12} /> Detected automatically</span><h2>Recurring charges</h2></div>
        <span className="ik-yearly"><b>{formatMoney(yearlyTotal)}</b><small>per year</small></span>
      </header>
      <div className="ik-recurring-list">
        {charges.map((charge) => {
          const logo = BRAND_MARKS[charge.merchant];
          const chosen = selected.includes(charge.merchant);
          const content = (
            <>
              <span className={`ik-merchant-mark ${merchantTone(charge.merchant)}`}>
                {charge.merchant === "Midtown Fitness"
                  ? <Dumbbell size={21} aria-hidden="true" />
                  : <span aria-hidden="true">{charge.merchant.slice(0, 1)}</span>}
                {logo && <img src={logo} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
              </span>
              <span className="ik-merchant-name"><b>{charge.merchant}</b><small>{friendlyCadence(charge.cadence)} · matched 3 times</small></span>
              <span className="ik-merchant-cost"><b>{formatMoney(charge.amount)}</b><small>/ month</small></span>
              {selectable && <span className={`ik-select-check${chosen ? " chosen" : ""}`}><Check size={13} /></span>}
            </>
          );
          return selectable ? (
            <button key={charge.id} type="button" className={chosen ? "chosen" : ""} onClick={() => onToggle(charge.merchant)}>{content}</button>
          ) : <article key={charge.id}>{content}</article>;
        })}
      </div>
      <footer><ShieldCheck size={13} /> Based on recent statement patterns—not guesses.</footer>
    </section>
  );
}

function findActiveStrategy(
  context: AIOnboardingContext,
  state: AIOnboardingState,
  message: string,
) {
  const unavailable = new Set([...state.acceptedStrategyIds, ...state.declinedStrategyIds]);
  const available = context.strategies.filter((strategy) => !unavailable.has(strategy.id));
  const lower = message.toLowerCase();
  return available.find((strategy) => {
    const target = strategy.kind === "cut_bucket"
      ? context.currentBudget.buckets.find((bucket) => bucket.id === strategy.targetId)?.name
      : context.recurringCharges.find((charge) => charge.id === strategy.targetId)?.merchant;
    return Boolean(target && lower.includes(target.toLowerCase()) && message.includes(formatMoney(strategy.toAmount)));
  }) ?? available.find((strategy) => {
    const target = strategy.kind === "cut_bucket"
      ? context.currentBudget.buckets.find((bucket) => bucket.id === strategy.targetId)?.name
      : context.recurringCharges.find((charge) => charge.id === strategy.targetId)?.merchant;
    return Boolean(target && lower.includes(target.toLowerCase()));
  }) ?? available[0];
}

function StrategyCard({
  strategy,
  context,
}: {
  strategy: OnboardingStrategy;
  context: AIOnboardingContext;
}) {
  const target = strategy.kind === "cut_bucket"
    ? context.currentBudget.buckets.find((bucket) => bucket.id === strategy.targetId)?.name ?? "Flexible spending"
    : context.recurringCharges.find((charge) => charge.id === strategy.targetId)?.merchant ?? "Subscription";
  const isCancel = strategy.kind === "cancel_subscription";
  return (
    <section className="ik-strategy-card" aria-label="Suggested budget tradeoff">
      <span className="ik-discovery-tag"><Sparkles size={12} /> One possible move</span>
      <div className="ik-strategy-target">
        <span className="ik-strategy-icon">{isCancel ? <CreditCard size={22} /> : <Utensils size={22} />}</span>
        <span><small>{isCancel ? "Recurring charge" : "Flexible bucket"}</small><b>{target}</b></span>
      </div>
      <div className="ik-tradeoff">
        <span><small>Now</small><b>{formatMoney(strategy.fromAmount)}</b></span>
        <span className="ik-trade-line"><i /><ArrowRight size={16} /><i /></span>
        <span><small>{isCancel ? "After" : "New target"}</small><b>{formatMoney(strategy.toAmount)}</b></span>
      </div>
      <div className="ik-unlocks">
        <span><CircleDollarSign size={18} /></span>
        <div><small>This creates</small><b>{formatMoney(strategy.freesPerPaycheck)} more every paycheck</b></div>
      </div>
    </section>
  );
}

function PlanCard({ plan }: { plan: PlanView }) {
  const goalTotal = plan.claims.reduce((sum, row) => sum + row.amount, 0);
  const protectedTotal = plan.buckets.reduce((sum, row) => sum + row.amount, 0);
  return (
    <section className="ik-plan" aria-label="Proposed budget">
      <header>
        <span><small>Every paycheck</small><strong>{formatMoney(plan.income)}</strong></span>
        <span className="ik-plan-ready"><Check size={13} /> Balanced</span>
      </header>
      <div className="ik-money-flow" aria-label="Paycheck allocation">
        <i className="protected" style={{ flexGrow: Math.max(protectedTotal, 1) }} />
        <i className="goals" style={{ flexGrow: Math.max(goalTotal, 1) }} />
      </div>
      <div className="ik-plan-legend">
        <span><i className="protected" /> Protected + spending</span>
        <span><i className="goals" /> Goals</span>
      </div>
      <div className="ik-plan-groups">
        <div>
          <h3><WalletCards size={15} /> Your buckets</h3>
          <ul>{plan.buckets.map((row) => <li key={row.name}><span>{row.name}</span><b>{formatMoney(row.amount)}</b></li>)}</ul>
        </div>
        {plan.claims.length > 0 && (
          <div className="ik-goal-allocation">
            <h3><Target size={15} /> Moving forward</h3>
            <ul>{plan.claims.map((row) => <li key={row.name}><span>{row.name}</span><b>+{formatMoney(row.amount)}</b></li>)}</ul>
          </div>
        )}
      </div>
      {plan.savings.length > 0 && <footer>You freed {formatMoney(plan.savings.reduce((sum, row) => sum + row.yearly, 0))} a year from recurring charges.</footer>}
    </section>
  );
}

function RhythmPreview() {
  return (
    <section className="ik-rhythm-preview" aria-label="Example Steward check-in">
      <div className="ik-phone-pulse"><BellRing size={20} /><i /></div>
      <div><span>Steward</span><b>You’re $28 ahead in Dining this week.</b><small>That puts the car fund a little closer.</small></div>
      <time>9:41</time>
    </section>
  );
}

function CompletionCard({ state }: { state: AIOnboardingState }) {
  const cadence = state.checkInCadence === "every_other_day"
    ? "Every other day"
    : state.checkInCadence === "daily" ? "Daily" : "Weekly";
  return (
    <section className="ik-complete-card">
      <span className="ik-complete-ring"><Check size={34} /></span>
      <h2>Plan built</h2>
      <p>{state.goals.length} {state.goals.length === 1 ? "goal" : "goals"} prioritized · {cadence} check-ins</p>
      <div>{state.goals.slice(0, 3).map((goal) => <span key={goal.id}><Target size={13} /> {goal.name}</span>)}</div>
    </section>
  );
}

function ChoiceGrid({
  replies,
  selected,
  onToggle,
  compact = false,
}: {
  replies: string[];
  selected: string[];
  onToggle: (reply: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`ik-choices${compact ? " compact" : ""}`} aria-label="Answer choices">
      {replies.map((reply) => {
        const chosen = selected.includes(reply);
        const Icon = iconForReply(reply);
        return (
          <button key={reply} type="button" className={chosen ? "chosen" : ""} aria-pressed={chosen} onClick={() => onToggle(reply)}>
            <span className="ik-choice-icon"><Icon size={18} /></span>
            <span>{reply}</span>
            <i>{chosen ? <Check size={13} /> : <ArrowRight size={13} />}</i>
          </button>
        );
      })}
    </div>
  );
}

function iconForReply(reply: string): ComponentType<{ size?: number }> {
  const label = reply.toLowerCase();
  if (/debt|loan|card/.test(label)) return CreditCard;
  if (/car|vehicle|auto/.test(label)) return CarFront;
  if (/home|house/.test(label)) return House;
  if (/trip|travel|vacation/.test(label)) return Plane;
  if (/saving|cushion|emergency/.test(label)) return PiggyBank;
  if (/buy|purchase|clothes|something/.test(label)) return ShoppingBag;
  if (/daily|week|day/.test(label)) return CalendarDays;
  if (/yes|accept|use this|correct|right|keep/.test(label)) return CheckCircle2;
  if (/no|decline|change|another|back|off/.test(label)) return ArrowRight;
  if (/breathing|bill|spending/.test(label)) return WalletCards;
  return Target;
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
