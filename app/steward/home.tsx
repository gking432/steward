"use client";

/**
 * HOME — orientation, in Steward's voice.
 *
 * Leads with what Steward makes of the situation, not with a metric. The
 * previous rebuild opened on "$110 — Left for everyday spending", which is a
 * number the user has to interpret; a chief of staff opens with the read and
 * puts the number underneath it.
 *
 * Everything on this screen is one deterministic sentence away from the engine.
 * Nothing is generated, and nothing here is a placeholder.
 *
 * Fits a viewport without scrolling. Content is bounded rather than clipped —
 * anything cut is reachable by tapping the block it belongs to.
 */

import { ArrowUpRight, ChevronRight, Settings, Sparkles } from "lucide-react";
import { useMemo } from "react";
import {
  bucketActivity,
  currentCycle,
  daysBetween,
  formatDate,
  formatMoney,
  planCycle,
} from "../../lib/model/engine";
import { dailyInsights, progressSummary } from "../../lib/model/decide";
import type { Bucket, Workspace } from "../../lib/model/types";
import "./home.css";

/**
 * Steward's read of the cycle. Deterministic: a small set of conditions over
 * engine output, phrased plainly. The AI layer may reword this, never replace
 * the judgement.
 */
function stewardsTake(workspace: Workspace, today: string) {
  const plan = planCycle(workspace, today);
  const cycle = currentCycle(workspace, today);
  if (!plan || !cycle) return null;

  const days = Math.max(0, daysBetween(today, cycle.end));
  const spend = workspace.buckets.filter((bucket) => bucket.kind === "spend");
  const activity = spend.map((bucket) => bucketActivity(workspace, bucket, cycle));
  const left = activity.reduce((sum, entry) => sum + Math.max(0, entry.remaining), 0);
  const over = activity.filter((entry) => entry.percent > 100);
  const hot = activity.filter((entry) => entry.hot && entry.percent <= 100);

  if (plan.shortfall) {
    return {
      tone: "alert" as const,
      line: `This paycheck is ${formatMoney(plan.shortfall.amount)} short.`,
      because: `${plan.shortfall.largestDriver} is the biggest driver. Steward won't cut an obligation — you choose what gives.`,
    };
  }
  if (over.length) {
    const worst = over.sort((a, b) => b.percent - a.percent)[0];
    return {
      tone: "watch" as const,
      line: `${worst.bucket.name} is over for this paycheck.`,
      because: `${formatMoney(worst.spent)} against ${formatMoney(worst.planned)}, with ${days} ${days === 1 ? "day" : "days"} still to go. The rest of your plan is intact.`,
    };
  }
  if (hot.length) {
    const worst = hot.sort((a, b) => b.percent - a.percent)[0];
    return {
      tone: "watch" as const,
      line: `Keep an eye on ${worst.bucket.name.toLowerCase()}.`,
      because: `${formatMoney(worst.remaining)} left with ${days} ${days === 1 ? "day" : "days"} until payday. Everything else is on track.`,
    };
  }
  return {
    tone: "good" as const,
    line: "You're on track.",
    because: `${formatMoney(left)} left to spend, ${days} ${days === 1 ? "day" : "days"} until payday, and every bill is covered.`,
  };
}

/** First word of the take, used to suppress an insight that repeats it. */
function takeSubject(line: string) {
  return line.split(" ")[0].toLowerCase();
}

export function HomeScreen({
  workspace,
  today,
  onOpenBuckets,
  onOpenBucket,
  onAsk,
  onSettings,
}: {
  workspace: Workspace;
  today: string;
  onOpenBuckets: () => void;
  onOpenBucket: (bucket: Bucket) => void;
  onAsk: () => void;
  onSettings: () => void;
}) {
  const plan = planCycle(workspace, today);
  const cycle = currentCycle(workspace, today);
  const progress = useMemo(() => progressSummary(workspace, today), [workspace, today]);
  const take = useMemo(() => stewardsTake(workspace, today), [workspace, today]);
  // Steward's take already names the worst bucket. Repeating it underneath
  // wastes the scarcest space on the screen and reads as the app forgetting
  // what it just said, so the insight only appears when it adds something.
  const insight = useMemo(() => {
    const candidates = dailyInsights(workspace, today);
    return candidates.find(
      (entry) => !take || !entry.headline.toLowerCase().startsWith(takeSubject(take.line)),
    );
  }, [workspace, today, take]);

  if (!take || !plan || !cycle) {
    return (
      <div className="hm-screen">
        <p className="hm-empty">Connect an account and Steward will build your plan.</p>
      </div>
    );
  }

  const days = Math.max(0, daysBetween(today, cycle.end));
  const allSpend = workspace.buckets
    .filter((bucket) => bucket.kind === "spend")
    .map((bucket) => bucketActivity(workspace, bucket, cycle))
    .filter((entry) => entry.planned > 0 || entry.spent > 0);

  // Every spend bucket, not the displayed ones. This was summing the slice, so
  // "Left to spend" silently changed with how many rows the list happened to
  // render — a headline figure that disagreed with the drilldown below it.
  const left = allSpend.reduce((sum, entry) => sum + Math.max(0, entry.remaining), 0);

  const spent = allSpend.reduce((sum, entry) => sum + entry.spent, 0);
  const activity = [...allSpend].sort((a, b) => b.percent - a.percent);

  const statusFor = (entry: (typeof activity)[number]) => {
    if (entry.remaining < 0 || entry.spent > entry.planned) return { label: "Over", tone: "over" };
    if (entry.hot) return { label: "Watch", tone: "watch" };
    return { label: "On track", tone: "good" };
  };

  return (
    <div className="hm-screen">
      <header className="hm-top">
        <span className="hm-mark" aria-hidden="true" />
        <strong>Steward</strong>
        <button className="hm-settings" onClick={onSettings} aria-label="Settings">
          <Settings size={18} />
        </button>
      </header>

      <div className="hm-scroll">
        <section className="hm-dashboard-head">
          <button className={`hm-take ${take.tone}`} onClick={onAsk}>
            <span className="hm-take-badge"><Sparkles size={13} /> Steward&apos;s take</span>
            <strong>{take.line}</strong>
            <p>{take.because}</p>
            <span className="hm-take-ask">Ask about this <ArrowUpRight size={14} /></span>
          </button>

          <div className="hm-figures">
            <button onClick={onOpenBuckets}><small>Left to spend</small><strong>{formatMoney(left)}</strong><em>this paycheck</em></button>
            <button onClick={onOpenBuckets}><small>Spent so far</small><strong>{formatMoney(spent)}</strong><em>across every bucket</em></button>
            <button onClick={onOpenBuckets}><small>Bills covered</small><strong>{formatMoney(plan.reservesTotal)}</strong><em>{plan.shortfall ? "needs attention" : "fully planned"}</em></button>
            <button onClick={onOpenBuckets}><small>Next paycheck</small><strong>{days}d</strong><em>{formatMoney(plan.freeCapacity)} for goals</em></button>
          </div>
        </section>

        <div className="hm-dashboard-grid">
          <section className="hm-panel hm-buckets-panel">
            <header><div><span className="hm-kicker">This paycheck</span><h1>Every spending bucket</h1></div><button onClick={onOpenBuckets}>Edit plan</button></header>
            <div className="hm-bucket-grid">
              {activity.map((entry) => {
                const status = statusFor(entry);
                const remaining = entry.remaining >= 0
                  ? `${formatMoney(entry.remaining)} left`
                  : `${formatMoney(Math.abs(entry.remaining))} over`;
                return (
                  <button className="hm-bucket-card" key={entry.bucket.id} onClick={() => onOpenBucket(entry.bucket)} aria-label={`View ${entry.bucket.name} activity`}>
                    <span className="hm-bucket-title"><b>{entry.bucket.name}</b><i className={status.tone}>{status.label}</i></span>
                    <strong>{remaining}</strong>
                    <small>{formatMoney(entry.spent)} spent of {formatMoney(entry.planned)}</small>
                    <span className="hm-bucket-bar"><i className={status.tone} style={{ width: `${Math.min(100, entry.percent)}%` }} /></span>
                    <span className="hm-bucket-open">View purchases <ChevronRight size={14} /></span>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="hm-side">
            <section className="hm-panel hm-bills">
              <header><div><span className="hm-kicker">Protected first</span><h2>Bills &amp; minimums</h2></div><button onClick={onOpenBuckets}>Plan</button></header>
              {plan.reserves.map((entry) => <button key={entry.bucket.id} onClick={onOpenBuckets}><span><b>{entry.bucket.name}</b><small>{entry.bucket.dueDate ? `Due ${formatDate(entry.bucket.dueDate)}` : "This cycle"}</small></span><strong>{formatMoney(entry.required)}</strong></button>)}
            </section>

            <section className="hm-panel hm-goals">
              <header><div><span className="hm-kicker">Your priorities</span><h2>Working toward</h2></div><button onClick={onOpenBuckets}>Plan</button></header>
              {progress.map((entry) => <div className="hm-goal" key={entry.claim.id}><span><b>{entry.claim.name}</b><small>{entry.arrivalDate ? `On track for ${formatDate(entry.arrivalDate)}` : "Building momentum"}</small></span><strong>{Math.round(entry.percent)}%</strong><span className="hm-bucket-bar"><i className="good" style={{ width: `${Math.min(100, entry.percent)}%` }} /></span></div>)}
              {!progress.length && <p className="hm-muted">Your next free dollars will appear here as they are assigned.</p>}
            </section>

            {insight && <button className="hm-insight" onClick={onOpenBuckets}><span className="hm-kicker">New insight</span><b>{insight.headline}</b><small>{insight.detail}</small><span>Review <ArrowUpRight size={14} /></span></button>}
          </aside>
        </div>
      </div>
    </div>
  );
}
