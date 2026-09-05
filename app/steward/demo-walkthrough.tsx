"use client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Landmark,
  ShieldCheck,
  Sparkles,
  Wallet,
} from "lucide-react";
import type { Workspace } from "../../lib/model/types";
import { demoFindings } from "../../lib/model/demo-findings";
import { money } from "../../lib/model/onboarding-conversation";
export function DemoWalkthrough({
  workspace,
  today,
  phase,
  onNext,
  onBack,
}: {
  workspace: Workspace;
  today: string;
  phase: number;
  onNext: () => void;
  onBack: () => void;
}) {
  const f = demoFindings(workspace, today);
  const rhythm = {
    Weekly: "Every week",
    Biweekly: "Every two weeks",
    Monthly: "Every month",
  }[f.frequency];
  const content = [
    [
      "A little clarity.\nA lot more possibility.",
      "Meet the financial assistant that helps you make room for the life you want.",
    ],
    ["Connect your accounts.", "Your whole picture. One place to start."],
    [
      "Checking your accounts.\nHere’s what I found.",
      "Your sample balances, paychecks, and spending are ready. Let’s take a look together.",
    ],
    [
      "Here’s what you have right now.",
      "Available in your sample checking and cash accounts.",
    ],
    [
      `${rhythm},\nyou get paid…`,
      "Your take-home pay, before we give every dollar a purpose.",
    ],
    [
      "Each week,\nyou spend about…",
      `An average across ${f.weeks} complete weeks of sample transactions.`,
    ],
    [
      "Now, let’s break down\nyour spending.",
      "The everyday things. The essentials. And everything in between.",
    ],
    ["Here’s where it goes.", "Your average spending per week."],
    [
      "After each paycheck,\nthere’s room for you.",
      "After planned bills, everyday spending, and your cash buffer.",
    ],
  ][phase];
  const amount =
    phase === 3
      ? f.cash
      : phase === 4
        ? f.income
        : phase === 5
          ? f.weekly
          : phase === 8
            ? (f.plan?.freeCapacity ?? 0)
            : null;
  return (
    <main
      className={`dw-shell ${phase < 3 ? "dw-dark" : ""}`}
      data-demo-phase={phase}
    >
      <header>
        <span className="dw-brand">
          <Sparkles size={21} /> Steward
        </span>
        <span className="dw-demo">Interactive demo</span>
      </header>
      <section className="dw-scene" key={phase} aria-live="polite">
        <div className="dw-avatar">
          {phase === 1 ? (
            <Landmark />
          ) : phase === 3 ? (
            <Wallet />
          ) : phase === 2 ? (
            <Check />
          ) : (
            <Sparkles />
          )}
        </div>
        <p className="dw-eyebrow">
          {phase < 2 ? "YOUR MONEY. YOUR LIFE." : "STEWARD’S FINDINGS"}
        </p>
        <h1>{content[0]}</h1>
        {amount !== null && (
          <div className="dw-amount">
            {money(amount)}
            <span>
              {phase === 3
                ? "available now"
                : phase === 5
                  ? "per week"
                  : "per paycheck"}
            </span>
          </div>
        )}
        {phase === 1 && (
          <div className="dw-accounts">
            {workspace.accounts
              .filter((a) => !a.archived)
              .slice(0, 4)
              .map((a) => (
                <div key={a.id}>
                  <span className="dw-bank-icon">
                    <Landmark size={18} />
                  </span>
                  <span>
                    <strong>{a.name}</strong>
                    <small>{a.type} · sample account</small>
                  </span>
                  <Check size={16} />
                </div>
              ))}
          </div>
        )}
        {phase === 7 && (
          <div className="dw-breakdown">
            {f.rows.map((r) => (
              <div key={r.label}>
                <span>{r.label}</span>
                <strong>{money(r.amount)}</strong>
              </div>
            ))}
          </div>
        )}
        <p className="dw-description">{content[1]}</p>
        {phase === 1 && (
          <p className="dw-disclosure">
            <ShieldCheck size={14} /> Demo connection only. No credentials or
            real bank access.
          </p>
        )}
        {phase === 7 && (
          <p className="dw-disclosure">
            {f.from} – {f.through} · {f.weeks} complete weeks
          </p>
        )}
        {phase === 8 && (
          <p className="dw-disclosure">
            A paycheck projection. Your current cash stays separate.
          </p>
        )}
      </section>
      <footer>
        {phase > 0 ? (
          <button
            className="dw-back"
            onClick={onBack}
            aria-label="Previous finding"
          >
            <ArrowLeft size={19} />
          </button>
        ) : (
          <span />
        )}
        <button className="dw-next" onClick={onNext}>
          {phase === 0
            ? "Get started"
            : phase === 1
              ? "Connect sample accounts"
              : phase === 8
                ? "Let’s talk goals"
                : "Next"}
          <ArrowRight size={17} />
        </button>
        <span className="dw-step">{phase + 1} / 9</span>
      </footer>
      <div className="dw-footnote">
        Fictional accounts · Sample date {today}
      </div>
    </main>
  );
}
