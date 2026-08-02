"use client";

/**
 * FIRST RUN (Phase 9).
 *
 * Deliver a real fact about the user's life before asking them for anything.
 *
 * The order matters more than the content. Asking "what are your goals?" first
 * is a homework assignment; asking it *after* showing someone that $440 of
 * every paycheck isn't spoken for is a question they want to answer. That
 * reveal is the hook, and it is computed from figures they just gave us — no
 * estimate, no invented number.
 *
 * Two hard rules (BLUEPRINT.md §J):
 *   - The manual path is first-class. A Plaid failure never blocks first run.
 *   - Steward must be fully useful with zero claims. "Not sure yet" is a real
 *     answer that lands the user in a working budgeting app.
 */

import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { formatMoney } from "../../lib/model/engine";
import type { StewardState } from "../../lib/steward-types";
import "./steward.css";

type Frequency = StewardState["profile"]["payFrequency"];

// The six things most people actually name when asked what their money is for.
// No amounts are invented for the open-ended ones — those land in Someday until
// the user gives them a number.
const STARTERS: { label: string; kind: "payoff" | "fund" | "purchase" | "commitment"; suggest: number | null }[] = [
  { label: "Pay off a credit card", kind: "payoff", suggest: null },
  { label: "Money for emergencies", kind: "fund", suggest: 1000 },
  { label: "Get out of overdraft", kind: "payoff", suggest: null },
  { label: "Something I need to buy", kind: "purchase", suggest: null },
  { label: "A trip", kind: "fund", suggest: null },
  { label: "Not sure yet", kind: "fund", suggest: null },
];

const cyclesPerMonth = (frequency: Frequency) =>
  frequency === "Weekly" ? 52 / 12 : frequency === "Biweekly" ? 26 / 12 : 1;

export function Onboarding({
  onComplete,
}: {
  onComplete: (input: {
    takeHome: number;
    frequency: Frequency;
    nextPayday: string;
    rent: number;
    otherBills: number;
    everyday: number;
    picks: { label: string; kind: string; amount: number | null }[];
  }) => void;
}) {
  const [step, setStep] = useState(1);
  const [takeHome, setTakeHome] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("Biweekly");
  const [nextPayday, setNextPayday] = useState("");
  const [rent, setRent] = useState("");
  const [otherBills, setOtherBills] = useState("");

  const [picked, setPicked] = useState<string[]>([]);

  const pay = Number(takeHome) || 0;
  const perCycle = (monthly: number) => monthly / cyclesPerMonth(frequency);
  const reservedPerCycle = perCycle((Number(rent) || 0) + (Number(otherBills) || 0));
  // Not asked. Nobody knows this number, which is the entire reason Steward
  // reads transactions. On the manual path Steward starts from what is left
  // after obligations and the user adjusts it on the buckets screen.
  const everydayPerCycle = Math.max(0, Math.round((pay - reservedPerCycle) * 0.45));
  const free = Math.max(0, Math.round((pay - reservedPerCycle - everydayPerCycle) * 100) / 100);

  const basicsReady = pay > 0 && nextPayday !== "";

  const finish = () =>
    onComplete({
      takeHome: pay,
      frequency,
      nextPayday,
      rent: Number(rent) || 0,
      otherBills: Number(otherBills) || 0,
      everyday: everydayPerCycle,
      picks: picked
        .filter((label) => label !== "Not sure yet")
        .map((label) => {
          const starter = STARTERS.find((entry) => entry.label === label)!;
          return { label, kind: starter.kind, amount: starter.suggest };
        }),
    });

  return (
    <main className="sw-onboard">
      <div className="sw-onboard-card">
        {step === 1 && (
          <>
            <span className="sw-eyebrow">Step 1 of 3</span>
            <h2>The basics</h2>
            <div className="sw-onboard-fields">
              <label>
                <span>Take-home pay, each paycheck</span>
                <input value={takeHome} onChange={(e) => setTakeHome(e.target.value)} inputMode="decimal" placeholder="2150" autoFocus />
              </label>
              <label>
                <span>How often</span>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                  <option>Weekly</option>
                  <option>Biweekly</option>
                  <option>Monthly</option>
                </select>
              </label>
              <label>
                <span>Next payday</span>
                <input type="date" value={nextPayday} onChange={(e) => setNextPayday(e.target.value)} />
              </label>
            </div>
            <button className="sw-primary" disabled={!basicsReady} onClick={() => setStep(2)}>
              Continue <ArrowRight size={15} />
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <span className="sw-eyebrow">Step 2 of 3</span>
            <h2>What has to come out</h2>
            <div className="sw-onboard-fields">
              <label>
                <span>Rent or mortgage, per month</span>
                <input value={rent} onChange={(e) => setRent(e.target.value)} inputMode="decimal" placeholder="1600" autoFocus />
              </label>
              <label>
                <span>Other bills, per month</span>
                <input value={otherBills} onChange={(e) => setOtherBills(e.target.value)} inputMode="decimal" placeholder="500" />
                <small>Utilities, phone, insurance, minimum payments.</small>
              </label>
            </div>
            <button className="sw-primary" onClick={() => setStep(3)}>
              Show me where I stand <ArrowRight size={15} />
            </button>
          </>
        )}

        {/* The reveal. Every figure here came from the user two screens ago. */}
        {step === 3 && (
          <>
            <span className="sw-eyebrow">Step 3 of 3</span>
            <h1 className="sw-reveal">
              {formatMoney(free)} of every paycheck isn&apos;t spoken for.
            </h1>
            <dl className="sw-math sw-reveal-math">
              <div><dt>Comes in</dt><dd>{formatMoney(pay)}</dd></div>
              <div><dt>Rent and bills, per paycheck</dt><dd>−{formatMoney(reservedPerCycle)}</dd></div>
              <div>
                <dt>Everyday spending <em>Steward&apos;s starting guess</em></dt>
                <dd>−{formatMoney(everydayPerCycle)}</dd>
              </div>
              <div className="sw-math-total"><dt>Yours to direct</dt><dd>{formatMoney(free)}</dd></div>
            </dl>
            <p>
              Connecting a bank replaces the guess with what you actually spend. Either way
              you can change all of it on the next screen.
            </p>

            <h2 className="sw-onboard-sub">What should that money do?</h2>
            <div className="sw-chips">
              {STARTERS.map((starter) => {
                const active = picked.includes(starter.label);
                return (
                  <button
                    key={starter.label}
                    className={active ? "sw-pick active" : "sw-pick"}
                    onClick={() =>
                      setPicked((current) =>
                        active
                          ? current.filter((label) => label !== starter.label)
                          : [...current, starter.label],
                      )
                    }
                  >
                    {active && <Check size={13} />} {starter.label}
                  </button>
                );
              })}
            </div>
            <button className="sw-primary" onClick={finish}>
              {picked.length ? "Build my plan" : "Skip for now"} <ArrowRight size={15} />
            </button>
            <small>
              Steward works without any of these — you&apos;ll still get your buckets, your
              bills and your spending.
            </small>
          </>
        )}
      </div>
    </main>
  );
}
