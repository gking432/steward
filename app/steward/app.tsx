"use client";

/**
 * STEWARD — Now / Path / Ledger, with "Can I buy this?" always one tap away.
 *
 * One responsive tree at every breakpoint. There is no mobile fork; that split
 * was the structural source of drift in the previous build.
 *
 * Every number rendered here comes from `lib/model/engine.ts` or
 * `lib/model/decide.ts`. This file formats and arranges; it never calculates.
 */

import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  ListChecks,
  Plus,
  Receipt,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  allocate,
  bucketActivity,
  currentCycle,
  daysBetween,
  formatDate,
  formatMoney,
  planCycle,
  projectArrivals,
  transactionsInCycle,
  type Arrival,
} from "../../lib/model/engine";
import {
  buildPaydayProposal,
  claimFromPurchase,
  confirmProposal,
  dailyInsights,
  evaluatePurchase,
  progressSummary,
  supersedeStaleProposals,
  type PaydayProposal,
  type Verdict,
} from "../../lib/model/decide";
import { fallbackIntent, type IntentDraft } from "../../lib/model/ai";
import type { Bucket, Claim, Workspace } from "../../lib/model/types";
import type { StewardState } from "../../lib/steward-types";
import { useWorkspace } from "./workspace-store";
import "./steward.css";

type Tab = "now" | "path" | "ledger";

const todayISO = (fixed?: string) => fixed ?? new Date().toISOString().slice(0, 10);

/* ------------------------------------------------------------- primitives */

function Bar({ percent, tone = "green" }: { percent: number; tone?: "green" | "amber" | "slate" }) {
  return (
    <div className="sw-bar" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <span className={`sw-bar-fill ${tone}`} style={{ width: `${Math.max(1.5, Math.min(100, percent))}%` }} />
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="sw-empty">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

/* -------------------------------------------------------------- NOW ----- */

function NowScreen({
  workspace,
  today,
  onOpenBucket,
  onGoPath,
  onGoLedger,
}: {
  workspace: Workspace;
  today: string;
  onOpenBucket: (bucket: Bucket) => void;
  onGoPath: () => void;
  onGoLedger: () => void;
}) {
  const plan = planCycle(workspace, today);
  const cycle = currentCycle(workspace, today);
  const insights = useMemo(() => dailyInsights(workspace, today), [workspace, today]);
  const progress = useMemo(() => progressSummary(workspace, today), [workspace, today]);

  if (!plan || !cycle) {
    return (
      <Empty
        title="No pay cycle yet"
        body="Connect an account or add your take-home pay and next payday, and Steward can build the plan."
      />
    );
  }

  const spendBuckets = workspace.buckets.filter((bucket) => bucket.kind === "spend");
  const activity = spendBuckets.map((bucket) => bucketActivity(workspace, bucket, cycle));
  const leftEveryday = activity.reduce((sum, entry) => sum + Math.max(0, entry.remaining), 0);
  const daysLeft = Math.max(0, daysBetween(today, cycle.end));
  const spentEveryday = activity.reduce((sum, entry) => sum + entry.spent, 0);
  const plannedEveryday = activity.reduce((sum, entry) => sum + entry.planned, 0);

  // The overview must fit a viewport, so each region shows a bounded number of
  // rows and hands off to a scrollable screen for the rest. Nothing is clipped:
  // whatever is cut is reachable by tapping the region it belongs to.
  const SHOWN_BUCKETS = 4;
  const shownBuckets = activity.slice(0, SHOWN_BUCKETS);
  const hiddenBuckets = activity.length - shownBuckets.length;
  const shownProgress = progress.slice(0, 2);
  const hiddenProgress = progress.length - shownProgress.length;

  const nextReserve = [...plan.reserves]
    .filter((entry) => entry.bucket.dueDate)
    .sort((a, b) => (a.bucket.dueDate! < b.bucket.dueDate! ? -1 : 1))[0];
  const insight = insights[0];

  return (
    <div className="sw-overview">
      {/* Cycle position. Taps through to the full breakdown in Ledger. */}
      <button className="sw-position tappable" onClick={onGoLedger}>
        <span className="sw-eyebrow">Left for everyday spending</span>
        <strong className="sw-huge">{formatMoney(leftEveryday)}</strong>
        <p className="sw-sub">
          {daysLeft} {daysLeft === 1 ? "day" : "days"} until payday · {formatMoney(spentEveryday)} of{" "}
          {formatMoney(plannedEveryday)} used
        </p>
        <Bar percent={plannedEveryday > 0 ? (spentEveryday / plannedEveryday) * 100 : 0} />
        <span className="sw-tap-hint">
          {formatMoney(plan.reservesTotal)} reserved · {formatMoney(plan.freeCapacity)} free
          <ArrowRight size={13} />
        </span>
      </button>

      {plan.shortfall && (
        <button className="sw-alert tappable" onClick={onGoLedger}>
          <strong>{formatMoney(plan.shortfall.amount)} short this cycle</strong>
          <p>{plan.shortfall.largestDriver} is the biggest driver.</p>
        </button>
      )}

      <section className="sw-block tight">
        <header className="sw-block-head">
          <h2>Buckets</h2>
          <button className="sw-link" onClick={onGoLedger}>
            {hiddenBuckets > 0 ? `+${hiddenBuckets} more` : "All"} <ArrowRight size={12} />
          </button>
        </header>
        <div className="sw-bucket-strip">
          {shownBuckets.map((entry) => (
            <button key={entry.bucket.id} className="sw-chip" onClick={() => onOpenBucket(entry.bucket)}>
              <span className="sw-chip-name">{entry.bucket.name}</span>
              <strong>{formatMoney(Math.max(0, entry.remaining))}</strong>
              <Bar percent={entry.percent} tone={entry.percent > 100 || entry.hot ? "amber" : "green"} />
            </button>
          ))}
          {!activity.length && <p className="sw-muted">No everyday buckets yet.</p>}
        </div>
      </section>

      <section className="sw-block tight">
        <header className="sw-block-head">
          <h2>Working toward</h2>
          <button className="sw-link" onClick={onGoPath}>
            {hiddenProgress > 0 ? `+${hiddenProgress} more` : "Path"} <ArrowRight size={12} />
          </button>
        </header>
        {shownProgress.length ? (
          <ul className="sw-progress">
            {shownProgress.map((entry) => (
              <li key={entry.claim.id}>
                <div>
                  <strong>{entry.claim.name}</strong>
                  <small>
                    {entry.arrivalDate ? formatDate(entry.arrivalDate) : "over a year out"}
                  </small>
                </div>
                <Bar percent={entry.percent} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="sw-muted">Nothing funded yet — ask “Can I buy this?” to start something.</p>
        )}
      </section>

      <div className="sw-overview-foot">
        {nextReserve && (
          <button className="sw-mini" onClick={onGoLedger}>
            <span>Next up</span>
            <strong>{nextReserve.bucket.name}</strong>
            <small>
              {formatMoney(nextReserve.bucket.reserved ?? 0)} of{" "}
              {formatMoney(nextReserve.bucket.amountDue ?? 0)} · {formatDate(nextReserve.bucket.dueDate ?? null)}
            </small>
          </button>
        )}
        {insight && (
          <button
            className={`sw-mini insight ${insight.tone}`}
            onClick={() => {
              const target = activity.find((entry) => insight.id.endsWith(entry.bucket.id));
              if (target) onOpenBucket(target.bucket);
              else onGoLedger();
            }}
          >
            <span><Sparkles size={12} /> Worth noticing</span>
            <strong>{insight.headline}</strong>
            <small>{insight.detail}</small>
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- PATH ----- */

function PathScreen({
  workspace,
  today,
  update,
  onAdd,
}: {
  workspace: Workspace;
  today: string;
  update: (next: (current: Workspace) => Workspace) => void;
  onAdd: () => void;
}) {
  const plan = planCycle(workspace, today);
  const arrivals = useMemo(() => projectArrivals(workspace, today), [workspace, today]);
  const allocation = useMemo(
    () => (plan ? allocate(workspace, plan.freeCapacity, today) : null),
    [workspace, plan, today],
  );
  const [showSomeday, setShowSomeday] = useState(false);

  const active = workspace.claims
    .filter((claim) => claim.status === "active" && claim.horizon === "arrival")
    .sort((a, b) => a.rank - b.rank);
  const someday = workspace.claims.filter((claim) => claim.status === "someday");
  const commitments = workspace.claims.filter(
    (claim) => claim.status === "active" && claim.horizon === "commitment",
  );

  const arrivalFor = (claim: Claim): Arrival | undefined =>
    arrivals.find((entry) => entry.claimId === claim.id);
  const amountFor = (claim: Claim) =>
    allocation?.allocations.find((entry) => entry.claim.id === claim.id)?.amount ?? 0;

  /** Reordering affects future cycles only; funded amounts never move. */
  const move = (claim: Claim, direction: -1 | 1) => {
    const ordered = [...active];
    const index = ordered.findIndex((entry) => entry.id === claim.id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= ordered.length) return;
    const ids = ordered.map((entry) => entry.id);
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
    update((current) => ({
      ...current,
      claims: current.claims.map((entry) => {
        const rank = ids.indexOf(entry.id);
        return rank === -1 ? entry : { ...entry, rank };
      }),
    }));
  };

  const setStatus = (claim: Claim, status: Claim["status"]) =>
    update((current) => ({
      ...current,
      claims: current.claims.map((entry) => (entry.id === claim.id ? { ...entry, status } : entry)),
    }));

  return (
    <div className="sw-screen">
      <section className="sw-position compact">
        <span className="sw-eyebrow">Yours to direct each paycheck</span>
        <strong className="sw-huge">{formatMoney(plan?.freeCapacity ?? 0)}</strong>
        <p className="sw-sub">after {formatMoney(plan?.reservesTotal ?? 0)} of bills and {formatMoney(plan?.spendTotal ?? 0)} of everyday spending</p>
      </section>

      {commitments.length > 0 && (
        <section className="sw-block">
          <header className="sw-block-head"><h2>On autopilot</h2></header>
          {commitments.map((claim) => (
            <div className="sw-row" key={claim.id}>
              <div><strong>{claim.name}</strong><small>continuing commitment</small></div>
              <b>{formatMoney(claim.pinned ?? 0)}<em>each paycheck</em></b>
            </div>
          ))}
        </section>
      )}

      <section className="sw-block">
        <header className="sw-block-head">
          <h2>Working toward</h2>
          <span>{active.length} of 7</span>
        </header>
        {active.length ? (
          <ol className="sw-claims">
            {active.map((claim, index) => {
              const arrival = arrivalFor(claim);
              const amount = amountFor(claim);
              const percent = claim.targetAmount > 0 ? (claim.fundedAmount / claim.targetAmount) * 100 : 0;
              return (
                <li key={claim.id} className={amount > 0 ? "funded" : "queued"}>
                  <div className="sw-claim-rank">{index + 1}</div>
                  <div className="sw-claim-body">
                    <div className="sw-claim-top">
                      <strong>{claim.name}</strong>
                      <span>{formatMoney(claim.fundedAmount)} of {formatMoney(claim.targetAmount)}</span>
                    </div>
                    <Bar percent={percent} tone={claim.kind === "payoff" ? "slate" : "green"} />
                    <div className="sw-claim-foot">
                      <small>
                        {amount > 0
                          ? `${formatMoney(amount)} this paycheck`
                          : arrival && arrival.startsInCycles > 0
                            ? "starts a later cycle"
                            : "not funded this cycle"}
                      </small>
                      <small className="sw-arrival">
                        {arrival?.arrivalDate ? formatDate(arrival.arrivalDate) : "more than a year out"}
                      </small>
                    </div>
                  </div>
                  <div className="sw-claim-actions">
                    <button onClick={() => move(claim, -1)} aria-label={`Move ${claim.name} up`} disabled={index === 0}>
                      <ChevronUp size={15} />
                    </button>
                    <button onClick={() => move(claim, 1)} aria-label={`Move ${claim.name} down`} disabled={index === active.length - 1}>
                      <ChevronDown size={15} />
                    </button>
                    <button onClick={() => setStatus(claim, "someday")} aria-label={`Move ${claim.name} to someday`}>
                      <X size={15} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <Empty title="Nothing here yet" body="Ask “Can I buy this?” and Steward will offer to start saving for whatever you're eyeing." />
        )}
        {allocation?.exceededConcentration && (
          <p className="sw-note">
            Funding {allocation.allocations.length} things at once — each arrives later than if you
            focused on fewer. That&apos;s your call to make.
          </p>
        )}
      </section>

      <section className="sw-block">
        <button className="sw-primary sw-add" onClick={onAdd}>
          <Plus size={16} /> Add something
        </button>
      </section>

      <section className="sw-block">
        <button className="sw-link" onClick={() => setShowSomeday((open) => !open)}>
          Someday · {someday.length} {showSomeday ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showSomeday && (
          <ul className="sw-someday">
            {someday.map((claim) => (
              <li key={claim.id}>
                <span>{claim.name}</span>
                <b>{formatMoney(claim.targetAmount)}</b>
                <button onClick={() => setStatus(claim, "active")}>Start funding</button>
              </li>
            ))}
            {!someday.length && <li className="sw-muted">Nothing parked.</li>}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ----------------------------------------------------------- LEDGER ----- */

function LedgerScreen({
  workspace,
  today,
  focusBucket,
  clearFocus,
}: {
  workspace: Workspace;
  today: string;
  focusBucket: Bucket | null;
  clearFocus: () => void;
}) {
  const cycle = currentCycle(workspace, today);
  const plan = planCycle(workspace, today);
  const [open, setOpen] = useState<string | null>(focusBucket?.id ?? null);

  if (!cycle || !plan) return <Empty title="No cycle" body="Add your pay schedule first." />;

  const rows = transactionsInCycle(workspace.transactions, cycle);
  const income = rows.filter((row) => row.type === "income").reduce((sum, row) => sum + row.amount, 0);
  const out = rows.filter((row) => row.type === "expense").reduce((sum, row) => sum + row.amount, 0);
  const spendBuckets = workspace.buckets.filter((bucket) => bucket.kind === "spend");

  return (
    <div className="sw-screen">
      <section className="sw-position compact">
        <span className="sw-eyebrow">
          This paycheck · {formatDate(cycle.start)} – {formatDate(cycle.end)}
        </span>
        <div className="sw-inout">
          <div><small>In</small><strong>{formatMoney(income)}</strong></div>
          <div><small>Out</small><strong>{formatMoney(out)}</strong></div>
          <div><small>Reserved</small><strong>{formatMoney(plan.reservesTotal)}</strong></div>
        </div>
      </section>

      {focusBucket && (
        <button className="sw-link" onClick={clearFocus}>
          <X size={13} /> Showing {focusBucket.name}
        </button>
      )}

      <section className="sw-block">
        <header className="sw-block-head"><h2>How this paycheck breaks down</h2></header>
        <dl className="sw-math">
          <div><dt>Paycheck</dt><dd>{formatMoney(plan.income)}</dd></div>
          <div><dt>Bills &amp; minimums reserved</dt><dd>−{formatMoney(plan.reservesTotal)}</dd></div>
          <div><dt>Everyday buckets</dt><dd>−{formatMoney(plan.spendTotal)}</dd></div>
          {plan.bufferTopUp > 0 && (
            <div><dt>Buffer top-up</dt><dd>−{formatMoney(plan.bufferTopUp)}</dd></div>
          )}
          <div className="sw-math-total"><dt>Free for what you&apos;re working toward</dt><dd>{formatMoney(plan.freeCapacity)}</dd></div>
        </dl>
      </section>

      <section className="sw-block">
        <header className="sw-block-head"><h2>Everyday buckets</h2></header>
        {spendBuckets.map((bucket) => {
          const activity = bucketActivity(workspace, bucket, cycle);
          const expanded = open === bucket.id;
          return (
            <div className="sw-ledger-bucket" key={bucket.id}>
              <button className="sw-ledger-head" onClick={() => setOpen(expanded ? null : bucket.id)}>
                <div>
                  <strong>{bucket.name}</strong>
                  <small>
                    {formatMoney(activity.spent)} of {formatMoney(activity.planned)} ·{" "}
                    {formatMoney(Math.max(0, activity.remaining))} left
                  </small>
                </div>
                <span className={activity.percent > 100 ? "sw-pct over" : "sw-pct"}>
                  {Math.round(activity.percent)}%
                </span>
                {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              <Bar percent={activity.percent} tone={activity.percent > 100 ? "amber" : activity.hot ? "amber" : "green"} />
              {expanded && (
                <div className="sw-drill">
                  {activity.rows.length ? (
                    <>
                      {activity.rows.map((row) => (
                        <div className="sw-drill-row" key={row.id}>
                          <span>{row.merchant}</span>
                          <small>{row.date}</small>
                          <b>{formatMoney(row.amount)}</b>
                        </div>
                      ))}
                      <div className="sw-drill-total">
                        <span>Total</span>
                        <b>{formatMoney(activity.spent)}</b>
                      </div>
                      <p className="sw-muted">You started this cycle with {formatMoney(activity.planned)}.</p>
                    </>
                  ) : (
                    <p className="sw-muted">Nothing spent here yet this cycle.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="sw-block">
        <header className="sw-block-head"><h2>Bills &amp; minimums</h2></header>
        {plan.reserves.map((entry) => (
          <div className="sw-row" key={entry.bucket.id}>
            <div>
              <strong>{entry.bucket.name}</strong>
              <small>
                {formatMoney(entry.bucket.reserved ?? 0)} of {formatMoney(entry.bucket.amountDue ?? 0)} reserved
                {entry.bucket.dueDate ? ` · due ${formatDate(entry.bucket.dueDate)}` : ""}
                {entry.cyclesRemaining > 1 ? ` · ${entry.cyclesRemaining} paychecks to go` : ""}
              </small>
            </div>
            <b>{formatMoney(entry.required)}<em>this cycle</em></b>
          </div>
        ))}
      </section>

      <section className="sw-block">
        <header className="sw-block-head"><h2>All activity</h2></header>
        <div className="sw-tx-list">
          {[...rows].sort((a, b) => b.date.localeCompare(a.date)).map((row) => (
            <div className="sw-tx" key={row.id}>
              <span className="sw-tx-mark">{row.merchant.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{row.merchant}</strong>
                <small>{row.category} · {row.date}</small>
              </div>
              <b className={row.type === "income" ? "pos" : ""}>
                {row.type === "income" ? "+" : "−"}{formatMoney(row.amount)}
              </b>
            </div>
          ))}
          {!rows.length && <Empty title="No activity this cycle" body="Transactions appear here as they import." />}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------- CAN I BUY THIS ------- */

function BuySheet({
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
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const ask = () => {
    const value = Number(price);
    if (!item.trim() || !Number.isFinite(value) || value <= 0) return;
    setVerdict(evaluatePurchase(workspace, today, { item: item.trim(), price: value }));
  };

  const saveForIt = () => {
    if (!verdict) return;
    const rank = workspace.claims.filter((claim) => claim.status === "active").length;
    update((current) => ({
      ...current,
      claims: [...current.claims, claimFromPurchase({ item: verdict.item, price: verdict.price, rank })],
    }));
    onClose();
  };

  return (
    <div className="sw-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="sw-sheet" role="dialog" aria-modal="true" aria-label="Can I buy this?" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>Can I buy this?</h2>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        {!verdict ? (
          <form
            className="sw-buy-form"
            onSubmit={(event) => {
              event.preventDefault();
              ask();
            }}
          >
            <label>
              <span>What is it?</span>
              <input value={item} onChange={(event) => setItem(event.target.value)} placeholder="Logitech keyboard" autoFocus />
            </label>
            <label>
              <span>How much?</span>
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="90" />
            </label>
            <button type="submit" className="sw-primary">Ask Steward</button>
          </form>
        ) : (
          <div className="sw-verdict">
            <span className="sw-eyebrow">{verdict.item} · {formatMoney(verdict.price)}</span>
            <strong className={`sw-answer ${verdict.answer}`}>{verdict.headline}</strong>

            <ul className="sw-checks">
              {verdict.checks.map((check) => (
                <li key={check.label} className={check.status}>
                  {check.status === "ok" ? <Check size={14} /> : <ShieldCheck size={14} />}
                  <div><strong>{check.label}</strong><small>{check.detail}</small></div>
                </li>
              ))}
            </ul>

            <div className="sw-tradeoff">
              <span>What it costs</span>
              <p>{verdict.tradeoff}</p>
            </div>

            <div className="sw-verdict-actions">
              {verdict.answer === "wait" && verdict.saveRate ? (
                <button className="sw-primary" onClick={saveForIt}>
                  Save for it — {formatMoney(verdict.saveRate)} a paycheck
                </button>
              ) : (
                <button className="sw-primary" onClick={onClose}>Got it</button>
              )}
              <button className="sw-secondary" onClick={saveForIt}>Add to Path</button>
              <button className="sw-secondary" onClick={() => setVerdict(null)}>Ask about something else</button>
            </div>
            <p className="sw-muted sw-fineprint">
              Planning guidance based on your own numbers — not financial advice.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}



/* ------------------------------------------------- ADD SOMETHING -------- */

/**
 * Explicit claim creation (amendment A4).
 *
 * Harvesting from "Can I buy this?" is the default path, but a user who
 * already knows what they want must be able to just say it. One field, plain
 * language, and a draft they confirm — never a multi-step goal wizard.
 *
 * Parsing runs deterministically first and is only enhanced by the model, so
 * this works with no API key configured.
 */
function AddClaimSheet({
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
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<IntentDraft | null>(null);
  const [thinking, setThinking] = useState(false);

  const parse = async () => {
    if (!text.trim()) return;
    setThinking(true);
    // Deterministic result first; the model may only refine it.
    let result = fallbackIntent(text, today);
    try {
      const response = await fetch("/api/steward-ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "intent", utterance: text, today }),
      });
      const payload = await response.json();
      if (payload?.draft) result = payload.draft;
    } catch {
      // Deterministic parse stands.
    }
    setDraft(result);
    setThinking(false);
  };

  const create = () => {
    if (!draft) return;
    const rank = workspace.claims.filter((claim) => claim.status === "active").length;
    update((current) => ({
      ...current,
      claims: [
        ...current.claims,
        {
          ...claimFromPurchase({
            item: draft.name,
            price: draft.amount ?? 0,
            wantBy: draft.wantBy ?? undefined,
            rank,
          }),
          kind: draft.kind,
          divisible: draft.kind !== "purchase",
          horizon: draft.kind === "commitment" ? ("commitment" as const) : ("arrival" as const),
          status: draft.amount ? ("active" as const) : ("someday" as const),
        },
      ],
    }));
    onClose();
  };

  return (
    <div className="sw-sheet-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="sw-sheet" role="dialog" aria-modal="true" aria-label="Add something"
        onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>What do you want?</h2>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        {!draft ? (
          <form className="sw-buy-form" onSubmit={(event) => { event.preventDefault(); void parse(); }}>
            <label>
              <span>Say it however you like</span>
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="I want $5,000 in emergency savings"
                autoFocus
              />
            </label>
            <p className="sw-muted">
              &ldquo;I want this credit card gone&rdquo; · &ldquo;a golf net&rdquo; ·
              &ldquo;save $20,000 for a house&rdquo;
            </p>
            <button type="submit" className="sw-primary" disabled={thinking}>
              {thinking ? "Reading that…" : "Continue"}
            </button>
          </form>
        ) : (
          <div className="sw-verdict">
            <span className="sw-eyebrow">Is this right?</span>
            <div className="sw-draft">
              <label>
                <span>Name</span>
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label>
                <span>Amount</span>
                <input
                  value={draft.amount ?? ""}
                  inputMode="decimal"
                  placeholder="How much?"
                  onChange={(e) =>
                    setDraft({ ...draft, amount: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </label>
              {draft.wantBy && (
                <p className="sw-muted">Target date: {formatDate(draft.wantBy)}</p>
              )}
            </div>
            <div className="sw-verdict-actions">
              <button className="sw-primary" onClick={create} disabled={!draft.amount}>
                {draft.amount ? "Add to Path" : "Add an amount to continue"}
              </button>
              <button className="sw-secondary" onClick={() => setDraft(null)}>Start over</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- PAYDAY -- */

/**
 * The payday moment. Reserves and obligations are automatic; discretionary
 * allocation is not.
 *
 * Dismissing this flow, or never opening it, confirms nothing. The free
 * capacity simply stays undirected and Now says so. Only the confirm button
 * writes allocations (BLUEPRINT.md §C10 / amendment A1).
 */
function PaydayFlow({
  workspace,
  proposal,
  onConfirm,
  onDismiss,
  update,
}: {
  workspace: Workspace;
  proposal: PaydayProposal;
  onConfirm: () => void;
  onDismiss: () => void;
  update: (next: (current: Workspace) => Workspace) => void;
}) {
  const [step, setStep] = useState<0 | 1 | 2>(0);

  // Reordering during payday recomputes the plan live, before anything is
  // written, so the user sees the consequence while deciding.
  const move = (claim: Claim, direction: -1 | 1) => {
    const active = workspace.claims
      .filter((entry) => entry.status === "active" && entry.horizon === "arrival")
      .sort((a, b) => a.rank - b.rank);
    const index = active.findIndex((entry) => entry.id === claim.id);
    const swap = index + direction;
    if (index < 0 || swap < 0 || swap >= active.length) return;
    const ids = active.map((entry) => entry.id);
    [ids[index], ids[swap]] = [ids[swap], ids[index]];
    update((current) => ({
      ...current,
      claims: current.claims.map((entry) => {
        const rank = ids.indexOf(entry.id);
        return rank === -1 ? entry : { ...entry, rank };
      }),
    }));
  };

  return (
    <div className="sw-sheet-backdrop" role="presentation">
      <div className="sw-sheet sw-payday" role="dialog" aria-modal="true" aria-label="Payday">
        <header>
          <h2>Payday</h2>
          <button onClick={onDismiss} aria-label="Close"><X size={18} /></button>
        </header>

        {step === 0 && (
          <div className="sw-payday-step">
            <span className="sw-eyebrow">Landed</span>
            <strong className="sw-huge">{formatMoney(proposal.income)}</strong>
            <p className="sw-sub">Let&apos;s put it to work.</p>
            <button className="sw-primary" onClick={() => setStep(1)}>Continue</button>
          </div>
        )}

        {step === 1 && (
          <div className="sw-payday-step">
            <span className="sw-eyebrow">Already taken care of</span>
            <div className="sw-payday-group">
              <h3>Bills &amp; minimums · {formatMoney(proposal.reservesTotal)}</h3>
              {proposal.reserves.map((entry) => (
                <div className="sw-payday-line" key={entry.name}>
                  <span>{entry.name}<small>{entry.note}</small></span>
                  <b>{formatMoney(entry.amount)}</b>
                </div>
              ))}
            </div>
            <div className="sw-payday-group">
              <h3>Everyday · {formatMoney(proposal.spendTotal)}</h3>
              {proposal.spend.map((entry) => (
                <div className="sw-payday-line" key={entry.name}>
                  <span>{entry.name}</span>
                  <b>{formatMoney(entry.amount)}</b>
                </div>
              ))}
            </div>
            {proposal.bufferTopUp > 0 && (
              <div className="sw-payday-group">
                <h3>Buffer top-up</h3>
                <div className="sw-payday-line"><span>Back to your floor</span><b>{formatMoney(proposal.bufferTopUp)}</b></div>
              </div>
            )}
            <div className="sw-payday-free">
              <span>Yours to direct</span>
              <strong>{formatMoney(proposal.freeCapacity)}</strong>
            </div>
            <button className="sw-primary" onClick={() => setStep(2)}>Continue</button>
          </div>
        )}

        {step === 2 && (
          <div className="sw-payday-step">
            <span className="sw-eyebrow">Here&apos;s what I&apos;d do with {formatMoney(proposal.freeCapacity)}</span>
            <ol className="sw-payday-plan">
              {proposal.lines.map((line, index) => (
                <li key={line.claim.id}>
                  <span className="sw-claim-rank">{index + 1}</span>
                  <div>
                    <strong>{line.claim.name}</strong>
                    <small>{line.reason}</small>
                  </div>
                  <div className="sw-payday-amount">
                    <b>{formatMoney(line.amount)}</b>
                    <em>{line.completes ? "complete" : line.arrival ? formatDate(line.arrival) : "over a year"}</em>
                  </div>
                  <div className="sw-claim-actions">
                    <button onClick={() => move(line.claim, -1)} aria-label={`Move ${line.claim.name} up`}>
                      <ChevronUp size={14} />
                    </button>
                    <button onClick={() => move(line.claim, 1)} aria-label={`Move ${line.claim.name} down`}>
                      <ChevronDown size={14} />
                    </button>
                  </div>
                </li>
              ))}
              {proposal.queued.map((entry) => (
                <li key={entry.claim.id} className="queued">
                  <span className="sw-claim-rank">–</span>
                  <div><strong>{entry.claim.name}</strong><small>starts a later cycle</small></div>
                  <div className="sw-payday-amount"><b>{formatMoney(0)}</b></div>
                </li>
              ))}
            </ol>
            <p className="sw-muted">Reorder anything — the dates update before you confirm.</p>
            <button className="sw-primary" onClick={onConfirm}>Confirm this plan</button>
            <button className="sw-secondary" onClick={onDismiss}>Not now</button>
            <p className="sw-muted sw-fineprint">
              Nothing is assigned to your goals until you confirm. Bills and minimums are
              already reserved either way.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- SHELL -- */

export function StewardApp({
  initialState,
  syncWithServer = true,
  fixedToday,
}: {
  initialState: StewardState;
  syncWithServer?: boolean;
  fixedToday?: string;
}) {
  const { workspace, update, loading, saveState } = useWorkspace(initialState, syncWithServer);
  const [tab, setTab] = useState<Tab>("now");
  const [buyOpen, setBuyOpen] = useState(false);
  const [focusBucket, setFocusBucket] = useState<Bucket | null>(null);
  const [paydayDismissed, setPaydayDismissed] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const today = todayISO(fixedToday);

  const proposal = useMemo(
    () => buildPaydayProposal(workspace, today),
    [workspace, today],
  );
  // Shown when a cycle has money to direct and has not been confirmed. Closing
  // it writes nothing; the plan stays pending until the next cycle supersedes it.
  const paydayDue =
    !!proposal && !proposal.confirmed && proposal.freeCapacity > 0 && !paydayDismissed;

  // Apply the stored appearance. Without this the page inherits the OS
  // preference and renders the dark palette regardless of the user's choice.
  useEffect(() => {
    const preference = workspace.profile.theme;
    const resolved =
      preference === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : preference;
    document.documentElement.dataset.theme = resolved;
  }, [workspace.profile.theme]);

  const hasData = workspace.accounts.length > 0 || workspace.profile.takeHomePay > 0;

  if (loading) {
    return <div className="sw-boot"><div className="sw-boot-mark" /><span>Steward</span></div>;
  }

  if (!hasData) {
    return (
      <main className="sw-onboard">
        <div>
          <h1>Know what you can spend.<br />Know what it costs you.</h1>
          <p>
            Connect an account and Steward will show you how much of every paycheck isn&apos;t
            already spoken for — then help you decide what it should do.
          </p>
          <a className="sw-primary" href="/legacy">Connect your bank</a>
          <small>Steward starts empty. There is no sample data to delete.</small>
        </div>
      </main>
    );
  }

  return (
    <div className="sw-app">
      <header className="sw-top">
        <div className="sw-brand">
          <span className="sw-mark" aria-hidden="true" />
          <strong>Steward</strong>
        </div>
        <span className={`sw-save ${saveState}`}>
          {saveState === "saving" ? "Saving" : saveState === "offline" ? "Session only" : "Saved"}
        </span>
      </header>

      <main className={tab === "now" ? "sw-main sw-main-fixed" : "sw-main"}>
        {tab === "now" && (
          <NowScreen
            workspace={workspace}
            today={today}
            onOpenBucket={(bucket) => {
              setFocusBucket(bucket);
              setTab("ledger");
            }}
            onGoPath={() => setTab("path")}
            onGoLedger={() => { setFocusBucket(null); setTab("ledger"); }}
          />
        )}
        {tab === "path" && (
          <PathScreen
            workspace={workspace}
            today={today}
            update={update}
            onAdd={() => setAddOpen(true)}
          />
        )}
        {tab === "ledger" && (
          <LedgerScreen
            workspace={workspace}
            today={today}
            focusBucket={focusBucket}
            clearFocus={() => setFocusBucket(null)}
          />
        )}
      </main>

      <nav className="sw-nav" aria-label="Main">
        <button className={tab === "now" ? "active" : ""} onClick={() => setTab("now")}>
          <Target size={19} /><span>Now</span>
        </button>
        <button className="sw-fab" onClick={() => setBuyOpen(true)} aria-label="Can I buy this?">
          <Plus size={22} />
        </button>
        <button className={tab === "path" ? "active" : ""} onClick={() => setTab("path")}>
          <ListChecks size={19} /><span>Path</span>
        </button>
        <button className={tab === "ledger" ? "active" : ""} onClick={() => { setFocusBucket(null); setTab("ledger"); }}>
          <Receipt size={19} /><span>Ledger</span>
        </button>
      </nav>

      {buyOpen && (
        <BuySheet workspace={workspace} today={today} update={update} onClose={() => setBuyOpen(false)} />
      )}

      {addOpen && (
        <AddClaimSheet workspace={workspace} today={today} update={update} onClose={() => setAddOpen(false)} />
      )}

      {paydayDue && proposal && (
        <PaydayFlow
          workspace={workspace}
          proposal={proposal}
          update={update}
          onDismiss={() => setPaydayDismissed(true)}
          onConfirm={() => {
            update((current) =>
              confirmProposal(supersedeStaleProposals(current, proposal.cycleId), proposal),
            );
            setPaydayDismissed(true);
          }}
        />
      )}
    </div>
  );
}

/* Referenced by the nav icons above; kept to avoid unused-import churn. */
export const icons = { CreditCard, Landmark, TrendingDown };
