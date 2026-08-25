"use client";

/**
 * FIRST RUN — an AI-led financial interview.
 *
 * Steward receives the complete transcript, every collected goal, a compact
 * verified financial snapshot, and the remaining safe tradeoffs on each turn.
 * The model decides what follow-up is necessary; deterministic code validates
 * its state and is the only layer allowed to change the budget.
 */

import { ArrowUp, Dumbbell, LoaderCircle, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allocate, formatMoney, planCycle } from "../../lib/model/engine";
import {
  EMPTY_AI_ONBOARDING_STATE,
  acceptAIOnboarding,
  acceptedCancellationStrategies,
  buildAIOnboardingContext,
  onboardingReplySubmitsImmediately,
  previewAIOnboarding,
  type AIOnboardingState,
  type AIOnboardingContext,
  type OnboardingPhase,
  type OnboardingTurn,
} from "../../lib/model/onboarding-ai";
import type { Workspace } from "../../lib/model/types";
import "./intake.css";

type Bubble = {
  id: string;
  from: "steward" | "you";
  text: string;
  plan?: PlanView;
  recurringReview?: AIOnboardingContext["recurringCharges"];
};

type PlanView = {
  income: number;
  buckets: { name: string; amount: number }[];
  claims: { name: string; amount: number }[];
  free: number;
  savings: { merchant: string; yearly: number }[];
};

type OnboardingResponse = {
  enhanced: boolean;
  message: string;
  quickReplies: string[];
  showPlan: boolean;
  phase: OnboardingPhase;
  state: AIOnboardingState;
};

const PHASES: OnboardingPhase[] = ["goals", "review", "strategy", "budget", "checkin", "complete"];

let seq = 0;
const nextId = () => `b${(seq += 1)}`;

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
  const [, setTurns] = useState<OnboardingTurn[]>([]);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [selectedReplies, setSelectedReplies] = useState<string[]>([]);
  const [phase, setPhase] = useState<OnboardingPhase>("goals");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);
  const stateRef = useRef(state);
  const turnsRef = useRef<OnboardingTurn[]>([]);
  const inFlightRef = useRef(false);

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

    if (said) {
      setBubbles((current) => [...current, { id: nextId(), from: "you", text: said }]);
      setTurns(conversation);
      turnsRef.current = conversation;
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
      if (!payload) throw new Error("Onboarding request failed");
      if (!payload.message || !payload.state) throw new Error("Invalid onboarding response");

      const preview = previewAIOnboarding(workspace, today, payload.state);
      const plan = payload.showPlan
        ? buildPlanView(workspace, preview, today, payload.state) ?? undefined
        : undefined;
      const assistantTurn: OnboardingTurn = { role: "assistant", content: payload.message };
      const nextTurns = [...conversation, assistantTurn];
      stateRef.current = payload.state;
      turnsRef.current = nextTurns;
      setState(payload.state);
      setTurns(nextTurns);
      setPhase(payload.phase);
      setQuickReplies(payload.quickReplies ?? []);
      const recurringReview = payload.phase === "review" &&
        payload.state.incomeConfirmed === true &&
        !payload.state.recurringReviewed &&
        context.recurringCharges.length > 0 &&
        /do you use all of these|anything look surprising/i.test(payload.message)
          ? context.recurringCharges
          : undefined;
      setBubbles((current) => [
        ...current,
        { id: nextId(), from: "steward", text: payload.message, plan, recurringReview },
      ]);
    } catch {
      setBubbles((current) => [
        ...current,
        {
          id: nextId(),
          from: "steward",
          text: "I lost the thread for a second. Send that once more and I’ll pick it up.",
        },
      ]);
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
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles, busy]);

  const progressIndex = Math.max(0, PHASES.indexOf(phase));
  const complete = state.complete;
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

  return (
    <main className="ik-screen">
      <header className="ik-top">
        <span className="ik-badge">
          <Sparkles size={13} /> {demoMode ? "Steward · Demo" : "Steward"}
        </span>
        <span className="ik-progress" aria-label={`Onboarding phase ${progressIndex + 1} of ${PHASES.length}`}>
          {PHASES.map((entry, index) => (
            <i
              key={entry}
              className={index < progressIndex ? "done" : index === progressIndex ? "current" : ""}
            />
          ))}
        </span>
      </header>

      <div className="ik-thread" ref={threadRef} aria-live="polite">
        {bubbles.map((bubble) => (
          <div className={`ik-msg ${bubble.from} ${bubble.recurringReview ? "has-review" : ""}`} key={bubble.id}>
            <p>{bubble.text}</p>
            {bubble.recurringReview && <RecurringReviewCard charges={bubble.recurringReview} />}
            {bubble.plan && <PlanCard plan={bubble.plan} />}
          </div>
        ))}
        {busy && (
          <div className="ik-msg steward pending" aria-label="Steward is thinking">
            <LoaderCircle size={15} className="ik-spin" /> Thinking…
          </div>
        )}
      </div>

      <div className="ik-answers">
        {!complete && quickReplies.length > 0 && (
          <div className="ik-chips" aria-label="Suggested replies">
            {quickReplies.map((reply) => (
              <button
                key={reply}
                className={`ik-chip ${selectedReplies.includes(reply) ? "active" : ""}`}
                aria-pressed={selectedReplies.includes(reply)}
                onClick={() => {
                  if (onboardingReplySubmitsImmediately(reply)) {
                    submit(`Selected: ${reply}.`);
                    return;
                  }
                  setSelectedReplies((current) => current.includes(reply)
                    ? current.filter((entry) => entry !== reply)
                    : [...current, reply]);
                }}
                disabled={busy}
              >
                {reply}
              </button>
            ))}
          </div>
        )}

        {complete ? (
          <button
            className="ik-primary"
            onClick={() => onDone(acceptAIOnboarding(workspace, today, state))}
          >
            View my budget
          </button>
        ) : (
          <form
            className="ik-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submitAnswer();
            }}
          >
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={busy
                ? "Steward is thinking…"
                : selectedReplies.length > 0
                  ? "Include more context?"
                  : "Message Steward"}
              aria-label="Your answer"
              disabled={busy}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={(!typed.trim() && selectedReplies.length === 0) || busy}
            >
              <ArrowUp size={18} />
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

const BRAND_MARKS: Record<string, string> = {
  Netflix: "https://cdn.simpleicons.org/netflix/E50914",
  Spotify: "https://cdn.simpleicons.org/spotify/1DB954",
};

function RecurringReviewCard({
  charges,
}: {
  charges: AIOnboardingContext["recurringCharges"];
}) {
  const yearlyTotal = charges.reduce((sum, charge) => sum + charge.yearlyCost, 0);
  return (
    <section className="ik-recurring" aria-label="Recurring charges Steward found">
      <header>
        <span>{charges.length} recurring charges</span>
        <strong>{formatMoney(yearlyTotal)} / year</strong>
      </header>
      <div className="ik-recurring-grid">
        {charges.map((charge) => {
          const logo = BRAND_MARKS[charge.merchant];
          return (
            <article key={charge.id}>
              <span className="ik-merchant-mark">
                {charge.merchant === "Midtown Fitness"
                  ? <Dumbbell size={20} aria-hidden="true" />
                  : <span aria-hidden="true">{charge.merchant.slice(0, 1)}</span>}
                {logo && (
                  <img
                    src={logo}
                    alt={`${charge.merchant} logo`}
                    onError={(event) => { event.currentTarget.style.display = "none"; }}
                  />
                )}
              </span>
              <b>{charge.merchant}</b>
              <span>{formatMoney(charge.amount)} / mo</span>
            </article>
          );
        })}
      </div>
      <footer><Sparkles size={12} /> Matched across recent statements</footer>
    </section>
  );
}

/** The plan, as rows. Every figure here was computed by the engine. */
function PlanCard({ plan }: { plan: PlanView }) {
  return (
    <div className="ik-plan">
      <div className="ik-plan-head">
        <small>Each paycheck</small>
        <strong>{formatMoney(plan.income)}</strong>
      </div>
      <ul>
        {plan.buckets.map((row) => (
          <li key={row.name}>
            <span>{row.name}</span>
            <b>{formatMoney(row.amount)}</b>
          </li>
        ))}
      </ul>
      {plan.claims.length > 0 && (
        <>
          <p className="ik-plan-sub">That leaves {formatMoney(plan.free)} for your goals:</p>
          <ul>
            {plan.claims.map((row) => (
              <li key={row.name} className="toward">
                <span>{row.name}</span>
                <b>{formatMoney(row.amount)}</b>
              </li>
            ))}
          </ul>
        </>
      )}
      {plan.savings.length > 0 && (
        <p className="ik-plan-note">
          Cancelling {plan.savings.map((row) => `${row.merchant} (${formatMoney(row.yearly)} a year)`).join(" and ")} adds more room.
        </p>
      )}
    </div>
  );
}
