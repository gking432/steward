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
 *   "I want to pay off my card" → claim created, plan recomputed, date quoted
 *   "want it sooner?"        → priced in real cuts, each one applyable
 *   "what about this paycheck?" → the plan, as sentences
 *
 * Nothing here is generated prose over a summary. If the engine cannot answer,
 * Steward says so rather than improvising.
 */

import { ArrowUp, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fallbackIntent, resolveDebtMention } from "../../lib/model/ai";
import {
  accelerate,
  claimFromPurchase,
  evaluatePurchase,
  planNarrative,
  promoteClaim,
  type Acceleration,
} from "../../lib/model/decide";
import { formatDate, formatMoney } from "../../lib/model/engine";
import type { Workspace } from "../../lib/model/types";
import "./ask.css";
import { EMPTY_CHAT_DRAFT, type ChatDraft } from "../../lib/model/chat-plan";
import { resolveFollowup, type PendingIntent } from "../../lib/model/conversation";

type Message = {
  id: string;
  from: "you" | "steward";
  text: string;
  lines?: string[];
  /** A claim this message is about, so "sooner?" has something to act on. */
  claimId?: string;
  options?: Acceleration;
  planProposal?: { workspace: Workspace; revision: number };
  proposal?: { claim: Workspace["claims"][number]; revision: number };
  debtChoices?: { id: string; name: string }[];
};

// Deliberately ordinary. These are the first words most people will read, so
// they should sound like anyone's money — not one person's hobbies.
const STARTERS = [
  "What should this paycheck do?",
  "I want to pay off my credit card",
  "Can I afford a $400 car repair?",
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
  const [chatDraft,setChatDraft]=useState<ChatDraft>(EMPTY_CHAT_DRAFT);
  const [aiStatus,setAiStatus]=useState("AI conversation · calculated answers");
  const [pending, setPending] = useState<PendingIntent | null>(null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [pendingDebtIds, setPendingDebtIds] = useState<string[]>([]);
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const say = (message: Omit<Message, "id">) =>
    setMessages((current) => [...current, { ...message, id: nextId() }]);

  /** Optional rewording. Never allowed to change or add a number. */
  const humanize = async (headline: string, detail: string) => `${headline} ${detail}`;

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
    setPending({kind:"purchase", name:item, missing:"amount"});
    const verdict = evaluatePurchase(workspace, today, { item, price });
    if (!verdict) {
      say({ from: "steward", text: "I need your pay schedule before I can answer that." });
      return;
    }
    const text = `${item} · ${formatMoney(price)}. ${await humanize(verdict.headline, verdict.tradeoff)}`;
    say({
      from: "steward",
      text,
      lines: verdict.checks.map((check) => `${check.label}: ${check.detail}`),
    });
  };

  const answerWant = (name: string, amount: number, wantBy?: string) => {
    setPending({kind:"goal", name, missing:"amount", wantBy});
    setMessages(current => current.map(message => ({...message, proposal:undefined})));
    const rank = workspace.claims.filter((claim) => claim.status === "active").length;
    const claim = claimFromPurchase({ item: name, price: amount, wantBy, rank });
    const projected: Workspace = { ...workspace, claims: [...workspace.claims, claim] };
    const narrative = planNarrative(projected, today);
    say({ from: "steward", text: `Proposed goal: ${name}, ${formatMoney(amount)}. Review before adding it. No money will be transferred.`, lines: narrative ? [narrative.summary] : [], proposal: { claim, revision: workspace.revision ?? 0 } });
  };

  const answerKnownDebt = (claimId: string) => {
    const claim = workspace.claims.find((entry) => entry.id === claimId);
    if (!claim || claim.kind !== "payoff") return;
    const remaining = Math.max(0, claim.targetAmount - claim.fundedAmount);
    const narrative = planNarrative(workspace, today);
    const line = narrative?.lines.find((entry) => entry.claimId === claim.id);
    const apr = claim.delayCost.type === "interest" ? claim.delayCost.apr : null;
    setPendingDebtIds([]);
    say({
      from: "steward",
      text: `${claim.name} has ${formatMoney(remaining)} left${apr === null ? "" : ` at ${apr.toFixed(2)}% APR`}.`,
      lines: line
        ? [`This paycheck: ${line.sentence}`]
        : ["It is already in your plan, but the money ahead of it is spoken for this paycheck."],
      claimId: claim.id,
      options: accelerate(workspace, claim.id, today) ?? undefined,
    });
  };

  const askWhichDebt = (claims: Workspace["claims"]) => {
    setPendingDebtIds(claims.map((claim) => claim.id));
    say({
      from: "steward",
      text: "Which one do you mean? I can use the balance and rate already on file.",
      debtChoices: claims.map((claim) => ({ id: claim.id, name: claim.name })),
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
      try {
        const response=await fetch('/api/steward-chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspace,today,mode:'ask',draft:chatDraft,turns:[...messages.map(m=>({role:m.from==='you'?'user':'assistant',content:m.text.slice(0,1200)})),{role:'user',content:text}].slice(-30)}),signal:AbortSignal.timeout(25000)});
        const result=await response.json();
        if(response.ok){
          setChatDraft(result.draft);setAiStatus('AI conversation · calculated answers');
          setMessages(current=>current.map(m=>({...m,proposal:undefined,planProposal:undefined})));
          if(result.draft.purchase?.amount){await answerPurchase(result.draft.purchase.name,result.draft.purchase.amount);return;}
          const changes=result.draft.goals.length||result.draft.bucketEdits.length||result.draft.income!==null;
          say({from:'steward',text:result.draft.message,
            lines:changes?[...result.draft.goals.map((g:ChatDraft['goals'][number])=>`${g.name}: ${g.amount===null?'open target':formatMoney(g.amount)}${g.date?` by ${g.date}`:''}`),...result.draft.bucketEdits.map((e:ChatDraft['bucketEdits'][number])=>`${workspace.buckets.find(b=>b.id===e.id)?.name}: ${formatMoney(e.amount)}`),...(result.draft.income===null?[]:[`Take-home per paycheck: ${formatMoney(result.draft.income)}`]),'Draft only. Review before applying.']:undefined,
            planProposal:changes&&!result.draft.goals.some((g:ChatDraft['goals'][number])=>g.kind==='purchase'&&!g.amount)?{workspace:result.preview,revision:result.sourceRevision}:undefined});
          return;
        }
        setAiStatus('AI unavailable · calculation tools');
        say({from:'steward',text:result.error??'AI is unavailable. The calculation tools below still work.'});
      } catch {setAiStatus('AI unavailable · calculation tools');say({from:'steward',text:'The AI connection failed. I can still check explicit purchases with the calculation engine.'});}
      const followup = resolveFollowup(pending, text);
      if (followup && 'cancelled' in followup) { setPending(null); setPendingDebtIds([]); setMessages(current => current.map(m => ({ ...m, proposal: undefined }))); say({from:"steward",text:"Cancelled. Your plan is unchanged."}); return; }
      if (followup && 'amount' in followup) { if (followup.kind === 'purchase') await answerPurchase(followup.name, followup.amount); else answerWant(followup.name, followup.amount, followup.wantBy); return; }
      setPending(null);
      setMessages(current => current.map(message => ({...message,proposal:undefined})));
      const isDebtIntent = /card|loan|debt|pay\s*off|paid off/.test(lower);
      if (pendingDebtIds.length) {
        const resolution = resolveDebtMention(workspace, text, pendingDebtIds);
        if (resolution.kind === "match") {
          answerKnownDebt(resolution.claim.id);
          return;
        }
        if (resolution.kind === "ambiguous") {
          askWhichDebt(resolution.claims);
          return;
        }
      }

      if (isDebtIntent) {
        const resolution = resolveDebtMention(workspace, text);
        if (resolution.kind === "match") {
          answerKnownDebt(resolution.claim.id);
          return;
        }
        if (resolution.kind === "ambiguous") {
          askWhichDebt(resolution.claims);
          return;
        }
      }

      if (/paycheck|plan|what should/.test(lower) && !/i want/.test(lower)) {
        await answerPlan();
      } else if (/can i (buy|afford)/.test(lower)) {
        const draft = fallbackIntent(text, today);
        if (draft?.amount) await answerPurchase(draft.name, draft.amount);
        else {
          setPending({ kind: "purchase", name: text.replace(/^can i (buy|afford)\s*/i, "").replace(/[?]$/, ""), missing: "amount" });
          say({
            from: "steward",
            text: "How much is it? I need the price to answer properly — I won't guess at it.",
          });
        }
      } else {
        const draft = fallbackIntent(text, today);
        if (draft?.amount) {
          answerWant(draft.name, draft.amount, draft.wantBy ?? undefined);
        } else if (draft) {
          setPending({kind:"goal",name:draft.name,missing:"amount"});
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

  /** Move a claim to the top and report the new date and what slipped. */
  const promote = (claimId: string, name: string) => {
    const result = promoteClaim(workspace, claimId, today);
    if (!result) return;
    update(() => result.workspace);
    const slipped = result.changes
      .filter((change) => change.direction === "later")
      .slice(0, 2)
      .map((change) => `${change.name} moves to ${formatDate(change.after)}`);
    say({
      from: "steward",
      text: result.arrival
        ? `${name} is top of your list now — it lands ${formatDate(result.arrival)}.`
        : `${name} is top of your list now.`,
      lines: slipped.length ? slipped : ["Nothing else moved."],
    });
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
        ? `Applied to this session — ${option.name} drops to ${formatMoney(option.currentPerCycle - option.suggestedCut)} a paycheck and ${acceleration.claim.name} lands ${formatDate(option.newArrival)}.`
        : `${option.name} drops to ${formatMoney(option.currentPerCycle - option.suggestedCut)} a paycheck.`,
    });
  };

  return (
    <div className="ak-screen">
      <header className="ak-top">
        <button onClick={() => {setMessages([]);setPending(null);setPendingDebtIds([]);}}>Clear conversation</button>
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

            {message.planProposal && <div className="ak-debt-choices"><button onClick={()=>{
              if(message.planProposal!.revision!==(workspace.revision??0)){say({from:'steward',text:'Your plan changed. Ask again to review a fresh draft.'});return;}
              update(()=>message.planProposal!.workspace);setChatDraft(EMPTY_CHAT_DRAFT);setPending(null);
              setMessages(current=>current.map(m=>({...m,planProposal:undefined,proposal:undefined})));
              say({from:'steward',text:'Applied the reviewed draft to this session. Check the save status for persistence.'});
            }}>Apply reviewed draft</button><button onClick={()=>{setChatDraft(EMPTY_CHAT_DRAFT);setMessages(current=>current.map(m=>({...m,planProposal:undefined})));}}>Cancel draft</button></div>}
            {message.proposal && <div className="ak-debt-choices">
              <button onClick={() => {
                if (message.proposal!.revision !== (workspace.revision ?? 0)) { say({from:"steward",text:"Your plan changed. Ask again to review an updated proposal."}); return; }
                setPending(null);
                update(current => ({...current, claims:[...current.claims,message.proposal!.claim]}));
                setMessages(current => current.map(m => m.id === message.id ? {...m,proposal:undefined} : m));
                say({from:"steward",text:`Added ${message.proposal!.claim.name} to this session's plan. See the save status for persistence.`});
              }}>Apply goal</button>
              <button onClick={() => { setInput(`I want ${message.proposal!.claim.name} for $${message.proposal!.claim.targetAmount}`); setMessages(current => current.map(m => m.id === message.id ? {...m,proposal:undefined} : m)); }}>Edit</button>
              <button onClick={() => { setPending(null); setMessages(current => current.map(m => m.id === message.id ? {...m,proposal:undefined} : m)); }}>Cancel</button>
            </div>}
            {message.debtChoices && (
              <div className="ak-debt-choices">
                {message.debtChoices.map((choice) => (
                  <button key={choice.id} onClick={() => answerKnownDebt(choice.id)}>
                    {choice.name}
                  </button>
                ))}
              </div>
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
                {message.claimId && (
                  <button
                    className="ak-promote"
                    onClick={() => promote(message.claimId!, message.options!.claim.name)}
                  >
                    <span>Move {message.options.claim.name} to the top</span>
                    <small>see what shifts</small>
                  </button>
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
        {aiStatus}. Planning guidance, not financial advice.
      </p>
    </div>
  );
}
