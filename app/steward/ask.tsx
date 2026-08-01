"use client";

/**
 * ASK — the conversation.
 *
 * This is the chief-of-staff surface: tell Steward what you want, get a plan
 * back, and negotiate it. It is deliberately *not* an open-ended assistant.
 * Every reply is built from engine output; the model only rewords, and the
 * guard in lib/model/ai.ts discards any figure it invents.
 *
 * The loop:
 *   "I want a golf net"      → claim created, plan recomputed, date quoted
 *   "want it sooner?"        → priced in real cuts, each one applyable
 *   "what about this paycheck?" → the plan, as sentences
 *
 * Nothing here is generated prose over a summary. If the engine cannot answer,
 * Steward says so rather than improvising.
 */

import { ArrowUp, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fallbackIntent } from "../../lib/model/ai";
import {
  accelerate,
  claimFromPurchase,
  evaluatePurchase,
  planNarrative,
  type Acceleration,
} from "../../lib/model/decide";
import { formatDate, formatMoney } from "../../lib/model/engine";
import type { Workspace } from "../../lib/model/types";
import "./ask.css";

type Message = {
  id: string;
  from: "you" | "steward";
  text: string;
  lines?: string[];
  /** A claim this message is about, so "sooner?" has something to act on. */
  claimId?: string;
  options?: Acceleration;
};

const STARTERS = [
  "What should this paycheck do?",
  "I want a golf net",
  "Can I buy a $90 keyboard?",
];

let seq = 0;
const nextId = () => `m${(seq += 1)}`;

export function AskScreen({
  workspace,
  today,
  onClose,
  update,
}: {
  workspace: Workspace;
  today: string;
  onClose: () => void;
  update: (next: (current: Workspace) => Workspace) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: nextId(),
      from: "steward",
      text: "Tell me what you want and I'll show you how to get there. Or ask what this paycheck should do.",
    },
  ]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const say = (message: Omit<Message, "id">) =>
    setMessages((current) => [...current, { ...message, id: nextId() }]);

  /** Optional rewording. Never allowed to change or add a number. */
  const humanise = async (headline: string, detail: string) => {
    try {
      const response = await fetch("/api/steward-ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "phrase", headline, verdict: headline, tradeoff: detail, checks: [] }),
      });
      const payload = await response.json();
      return payload?.text ?? `${headline} ${detail}`;
    } catch {
      return `${headline} ${detail}`;
    }
  };

  const answerPlan = async () => {
    const narrative = planNarrative(workspace, today);
    if (!narrative) {
      say({ from: "steward", text: "I need your pay schedule before I can plan a cycle." });
      return;
    }
    say({
      from: "steward",
      text: narrative.summary,
      lines: [
        ...narrative.lines.map((line) => line.sentence),
        ...(narrative.queued.length
          ? [`${narrative.queued.join(" and ")} waits for a later paycheck.`]
          : []),
      ],
    });
  };

  const answerPurchase = async (item: string, price: number) => {
    const verdict = evaluatePurchase(workspace, today, { item, price });
    if (!verdict) {
      say({ from: "steward", text: "I need your pay schedule before I can answer that." });
      return;
    }
    const text = await humanise(verdict.headline, verdict.tradeoff);
    say({
      from: "steward",
      text,
      lines: verdict.checks.map((check) => `${check.label}: ${check.detail}`),
    });
  };

  const answerWant = (name: string, amount: number, wantBy?: string) => {
    const rank = workspace.claims.filter((claim) => claim.status === "active").length;
    const claim = claimFromPurchase({ item: name, price: amount, wantBy, rank });
    update((current) => ({ ...current, claims: [...current.claims, claim] }));

    // Project against the workspace as it will be, so the date quoted is real.
    const projected: Workspace = { ...workspace, claims: [...workspace.claims, claim] };
    const narrative = planNarrative(projected, today);
    const line = narrative?.lines.find((entry) => entry.claimId === claim.id);

    say({
      from: "steward",
      text: line
        ? line.completes
          ? `Done — ${formatMoney(amount)} covers ${name} out of this paycheck.`
          : `Added. ${line.sentence}`
        : `Added ${name} at ${formatMoney(amount)}. It waits for a later paycheck — everything ahead of it is already spoken for.`,
      claimId: claim.id,
      options: accelerate(projected, claim.id, today) ?? undefined,
    });
  };

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text || thinking) return;
    say({ from: "you", text });
    setInput("");
    setThinking(true);

    const lower = text.toLowerCase();
    try {
      if (/paycheck|plan|what should/.test(lower) && !/i want/.test(lower)) {
        await answerPlan();
      } else if (/can i (buy|afford)/.test(lower)) {
        const draft = fallbackIntent(text, today);
        if (draft?.amount) await answerPurchase(draft.name, draft.amount);
        else
          say({
            from: "steward",
            text: "How much is it? I need the price to answer properly — I won't guess at it.",
          });
      } else {
        const draft = fallbackIntent(text, today);
        if (draft?.amount) {
          answerWant(draft.name, draft.amount, draft.wantBy ?? undefined);
        } else if (draft) {
          say({
            from: "steward",
            text: `How much is ${draft.name.toLowerCase()}? Give me a number and I'll work out when you can have it.`,
          });
        }
      }
    } finally {
      setThinking(false);
    }
  };

  /** Apply a cut and report the new date, both from the engine. */
  const applyCut = (acceleration: Acceleration, bucketId: string) => {
    const option = acceleration.options.find((entry) => entry.bucketId === bucketId);
    if (!option) return;
    update((current) => ({
      ...current,
      buckets: current.buckets.map((bucket) =>
        bucket.id === bucketId
          ? { ...bucket, perCycle: Math.max(0, (bucket.perCycle ?? 0) - option.suggestedCut) }
          : bucket,
      ),
    }));
    say({
      from: "steward",
      text: option.newArrival
        ? `Done — ${option.name} drops to ${formatMoney(option.currentPerCycle - option.suggestedCut)} a paycheck and ${acceleration.claim.name} lands ${formatDate(option.newArrival)}.`
        : `${option.name} drops to ${formatMoney(option.currentPerCycle - option.suggestedCut)} a paycheck.`,
    });
  };

  return (
    <div className="ak-screen">
      <header className="ak-top">
        <span className="ak-badge">
          <Sparkles size={14} /> Steward
        </span>
        <button onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>
      </header>

      <div className="ak-thread" ref={threadRef} aria-live="polite">
        {messages.map((message) => (
          <div className={`ak-msg ${message.from}`} key={message.id}>
            <p>{message.text}</p>
            {message.lines && (
              <ul>
                {message.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}

            {message.options && message.options.neededPerCycle > 0 && (
              <div className="ak-sooner">
                <strong>Want it sooner?</strong>
                {message.options.enoughAvailable ? (
                  <>
                    <p>
                      It needs {formatMoney(message.options.neededPerCycle)} more from this
                      paycheck. Here&apos;s where it could come from.
                    </p>
                    {message.options.options.map((option) => (
                      <button key={option.bucketId} onClick={() => applyCut(message.options!, option.bucketId)}>
                        <span>
                          Cut {option.name} by {formatMoney(option.suggestedCut)}
                        </span>
                        <small>
                          {option.newArrival
                            ? `lands ${formatDate(option.newArrival)}`
                            : "no change to the date"}
                        </small>
                      </button>
                    ))}
                  </>
                ) : (
                  <p>
                    It needs {formatMoney(message.options.neededPerCycle)} more this paycheck, and
                    trimming everything discretionary only frees{" "}
                    {formatMoney(message.options.totalAvailable)}. Moving it up your list is the
                    faster route.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        {thinking && <div className="ak-msg steward pending">Working it out…</div>}
      </div>

      <div className="ak-starters">
        {STARTERS.map((starter) => (
          <button key={starter} onClick={() => void send(starter)}>
            {starter}
          </button>
        ))}
      </div>

      <form
        className="ak-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Tell Steward what you want"
          aria-label="Message Steward"
        />
        <button type="submit" aria-label="Send" disabled={!input.trim()}>
          <ArrowUp size={19} />
        </button>
      </form>
      <p className="ak-fineprint">
        Steward works from your own numbers. Planning guidance, not financial advice.
      </p>
    </div>
  );
}
