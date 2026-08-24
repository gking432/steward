"use client";

/**
 * FIRST RUN — the conversation.
 *
 * This is the front door. Connect a bank, and while the scan runs Steward asks
 * what you're trying to do; then it tells you what it found, proposes a plan,
 * and only once you agree does the rest of the app open.
 *
 * The order is what makes it work. Asking about goals first needs no
 * transaction data, so the sync happens behind a question the user wants to
 * answer rather than behind a spinner.
 *
 * Every question and every branch lives in lib/model/intake.ts, and every
 * figure comes from the engine. This file renders and collects — it decides
 * nothing.
 */

import { ArrowUp, Check, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { allocate, formatMoney, planCycle } from "../../lib/model/engine";
import {
  acceptIntake,
  applyIntake,
  applyTweak,
  cancelledSubscriptions,
  intakeProgress,
  nextStep,
  type IntakeAnswer,
  type IntakeStep,
} from "../../lib/model/intake";
import { annualCost } from "../../lib/model/observations";
import type { Workspace } from "../../lib/model/types";
import "./intake.css";

type Bubble = {
  id: string;
  from: "steward" | "you";
  text: string;
  /** Rendered under the message: the plan, as rows the engine produced. */
  plan?: PlanView;
};

type PlanView = {
  income: number;
  buckets: { name: string; amount: number }[];
  claims: { name: string; amount: number }[];
  free: number;
  savings: { merchant: string; yearly: number }[];
};

let seq = 0;
const nextId = () => `b${(seq += 1)}`;

/**
 * Map what the user typed onto one of Steward's own options.
 *
 * Closed-set: the endpoint discards anything that isn't an option Steward
 * offered, and returns null. Null is a normal outcome — with no API key it is
 * the only outcome — so the caller must always have somewhere to go.
 */
async function classify(utterance: string, choices: string[]): Promise<string | null> {
  try {
    const response = await fetch("/api/steward-ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "choose", utterance, choices }),
    });
    const payload = await response.json();
    return typeof payload?.choice === "string" ? payload.choice : null;
  } catch {
    return null;
  }
}

/**
 * Optional rewording of a scripted prompt. Returns the original on any failure,
 * and the endpoint rejects any rewrite that introduces a figure — so this can
 * only ever change the wording, never the facts.
 */
async function reword(text: string): Promise<string> {
  try {
    const response = await fetch("/api/steward-ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "reword", text }),
    });
    const payload = await response.json();
    return typeof payload?.text === "string" ? payload.text : text;
  } catch {
    return text;
  }
}

/**
 * The proposal, entirely from the engine. The conversation may describe this;
 * it may never compute it.
 */
function buildPlanView(workspace: Workspace, today: string, answers: IntakeAnswer[]): PlanView | null {
  // Preview the answers in the proposal before anything is committed. Without
  // this, the plan card described the imported fixture but ignored the goals
  // the visitor had just chosen — the exact opposite of an onboarding demo.
  const personalized = applyIntake(workspace, today, answers);
  const plan = planCycle(personalized, today);
  if (!plan) return null;
  const ranked = allocate(personalized, plan.freeCapacity, today);

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
    savings: cancelledSubscriptions(workspace, today, answers).map((stream) => ({
      merchant: stream.merchant,
      yearly: annualCost(stream),
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
  /** False while the bank sync is still running. Gates every factual phase. */
  scanComplete: boolean;
  demoMode?: boolean;
  onDone: (next: Workspace) => void;
}) {
  const [answers, setAnswers] = useState<IntakeAnswer[]>([]);
  const [picks, setPicks] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [classifying, setClassifying] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);

  /**
   * The workspace as the conversation has reshaped it. Negotiating the plan
   * changes real numbers, and the user has to see the result before agreeing —
   * so tweaks are held here and only committed when they accept.
   */
  // Derived, not synced: until a tweak exists the live workspace IS the draft,
  // so a scan landing mid-conversation is picked up for free. Once the user
  // changes something, their version takes over. Tweaking only unlocks at the
  // plan phase — after the scan — so the two never race.
  const [tweakedDraft, setTweakedDraft] = useState<Workspace | null>(null);
  const draft = tweakedDraft ?? workspace;

  const step = useMemo(
    () => nextStep(draft, today, answers, scanComplete),
    [draft, today, answers, scanComplete],
  );
  const progress = useMemo(
    () => intakeProgress(draft, today, answers),
    [draft, today, answers],
  );

  // Push each new question into the thread as Steward "says" it, then swap in a
  // reworded version if the model is available and its rewrite passes the
  // guard. The scripted line shows immediately either way — the conversation
  // never waits on the network to say something it already knows.
  const shownRef = useRef<string | null>(null);
  useEffect(() => {
    if (!step || shownRef.current === step.id) return;
    shownRef.current = step.id;
    const id = nextId();
    setBubbles((current) => [
      ...current,
      {
        id,
        from: "steward",
        text: step.prompt,
        plan: step.kind === "plan" ? (buildPlanView(draft, today, answers) ?? undefined) : undefined,
      },
    ]);

    let live = true;
    void reword(step.prompt).then((text) => {
      if (!live || text === step.prompt) return;
      setBubbles((current) =>
        current.map((bubble) => (bubble.id === id ? { ...bubble, text } : bubble)),
      );
    });
    return () => {
      live = false;
    };
  }, [step, draft, today, answers]);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles]);

  // The conversation is over: fold it in and hand off to the app.
  useEffect(() => {
    if (step === null && scanComplete && answers.length > 0) {
      onDone(acceptIntake(draft, today, answers));
    }
  }, [step, scanComplete, answers, draft, today, onDone]);

  const answer = (current: IntakeStep, choice: string, text?: string) => {
    setBubbles((existing) => [...existing, { id: nextId(), from: "you", text: text ?? choice }]);

    // A tweak actually reshapes the plan. Carry it out, then say what moved —
    // the next plan card is rendered from the reshaped workspace, so the user
    // agrees to what they'll actually get rather than to the first draft.
    if (current.kind === "tweak") {
      const result = applyTweak(draft, today, choice);
      if (result) {
        setTweakedDraft(result.workspace);
        setBubbles((existing) => [
          ...existing,
          { id: nextId(), from: "steward", text: result.summary },
        ]);
      }
    }

    setAnswers((existing) => [
      ...existing,
      {
        stepId: current.id,
        choice,
        picks: current.multi ? picks : undefined,
        text,
      },
    ]);
    setPicks([]);
    setTyped("");
  };

  const togglePick = (label: string) =>
    setPicks((current) =>
      current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label],
    );

  return (
    <main className="ik-screen">
      <header className="ik-top">
        <span className="ik-badge">
          <Sparkles size={13} /> {demoMode ? "Demo · Fake bank data" : "Steward"}
        </span>
        <span
          className="ik-progress"
          aria-label={`Step ${Math.min(progress.of, progress.phase + 1)} of ${progress.of}`}
        >
          {Array.from({ length: progress.of }, (_, index) => (
            <i
              key={index}
              className={index < progress.phase ? "done" : index === progress.phase ? "current" : ""}
            />
          ))}
        </span>
      </header>

      <div className="ik-thread" ref={threadRef} aria-live="polite">
        {bubbles.map((bubble) => (
          <div className={`ik-msg ${bubble.from}`} key={bubble.id}>
            <p>{bubble.text}</p>
            {bubble.plan && <PlanCard plan={bubble.plan} />}
          </div>
        ))}

        {/* The scan is still running and there is nothing truthful to say yet. */}
        {!step && !scanComplete && (
          <div className="ik-msg steward pending">Reading your transactions…</div>
        )}
      </div>

      {step && (
        <div className="ik-answers">
          {step.multi ? (
            <>
              <div className="ik-chips">
                {step.choices.map((choice) => (
                  <button
                    key={choice}
                    className={picks.includes(choice) ? "ik-chip active" : "ik-chip"}
                    onClick={() => togglePick(choice)}
                  >
                    {picks.includes(choice) && <Check size={13} />} {choice}
                  </button>
                ))}
              </div>
              <button
                className="ik-primary"
                onClick={() => answer(step, picks[0] ?? "Not sure yet", picks.join(", ") || "Not sure yet")}
              >
                Continue
              </button>
            </>
          ) : (
            <div className="ik-chips">
              {step.choices.map((choice) => (
                <button key={choice} className="ik-chip" onClick={() => answer(step, choice)}>
                  {choice}
                </button>
              ))}
            </div>
          )}

          {/*
            Free text is always available, never required. With an API key the
            model maps what they typed onto one of the choices above; without
            one the chips are the whole interface and this still records what
            they said.
          */}
          <form
            className="ik-composer"
            onSubmit={(event) => {
              event.preventDefault();
              const said = typed.trim();
              if (!said || classifying) return;
              setTyped("");
              setClassifying(true);
              void classify(said, step.choices)
                .then((choice) => {
                  if (choice) {
                    answer(step, choice, said);
                    return;
                  }
                  // No key, or nothing matched. Steward must not guess at what
                  // they meant — it keeps what they said and asks them to tap.
                  setBubbles((current) => [
                    ...current,
                    { id: nextId(), from: "you", text: said },
                    {
                      id: nextId(),
                      from: "steward",
                      text: "I want to be sure I've got that right — which of these is closest?",
                    },
                  ]);
                })
                .finally(() => setClassifying(false));
            }}
          >
            <input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="Or say it in your own words"
              aria-label="Your answer"
            />
            <button type="submit" aria-label="Send" disabled={!typed.trim() || classifying}>
              <ArrowUp size={18} />
            </button>
          </form>
        </div>
      )}
    </main>
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
          <p className="ik-plan-sub">That leaves {formatMoney(plan.free)} to put to work:</p>
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
          Cancelling{" "}
          {plan.savings.map((row) => `${row.merchant} (${formatMoney(row.yearly)} a year)`).join(" and ")}{" "}
          frees that up on top.
        </p>
      )}
    </div>
  );
}
