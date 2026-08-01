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
  claimFromPurchase,
  dailyInsights,
  evaluatePurchase,
  progressSummary,
  type Verdict,
} from "../../lib/model/decide";
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
}: {
  workspace: Workspace;
  today: string;
  onOpenBucket: (bucket: Bucket) => void;
  onGoPath: () => void;
}) {
  const plan = planCycle(workspace, today);
  const cycle = currentCycle(workspace, today);
  const insights = useMemo(() => dailyInsights(workspace, today), [workspace, today]);
  const progress = useMemo(() => progressSummary(workspace, today), [workspace, today]);
  const [showMath, setShowMath] = useState(false);

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

  const nextReserve = [...plan.reserves]
    .filter((entry) => entry.bucket.dueDate)
    .sort((a, b) => (a.bucket.dueDate! < b.bucket.dueDate! ? -1 : 1))[0];

  return (
    <div className="sw-screen">
      {/* 1 — cycle position. A ledger figure the user can reconstruct, not a verdict. */}
      <section className="sw-position">
        <span className="sw-eyebrow">Left for everyday spending</span>
        <strong className="sw-huge">{formatMoney(leftEveryday)}</strong>
        <p className="sw-sub">
          {daysLeft} {daysLeft === 1 ? "day" : "days"} until payday · {formatMoney(spentEveryday)} of{" "}
          {formatMoney(plannedEveryday)} used
        </p>
        <Bar percent={plannedEveryday > 0 ? (spentEveryday / plannedEveryday) * 100 : 0} />
        <button className="sw-link" onClick={() => setShowMath((open) => !open)}>
          {showMath ? "Hide the math" : "Where the rest went"} {showMath ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {showMath && (
          <dl className="sw-math">
            <div><dt>Paycheck</dt><dd>{formatMoney(plan.income)}</dd></div>
            <div><dt>Bills &amp; minimums reserved</dt><dd>−{formatMoney(plan.reservesTotal)}</dd></div>
            <div><dt>Everyday buckets</dt><dd>−{formatMoney(plan.spendTotal)}</dd></div>
            {plan.bufferTopUp > 0 && <div><dt>Buffer top-up</dt><dd>−{formatMoney(plan.bufferTopUp)}</dd></div>}
            <div className="sw-math-total"><dt>Free for your goals</dt><dd>{formatMoney(plan.freeCapacity)}</dd></div>
          </dl>
        )}
      </section>

      {/* 2 — at risk. Absent when nothing is wrong; silence is the default. */}
      {plan.shortfall && (
        <section className="sw-alert">
          <strong>{formatMoney(plan.shortfall.amount)} short this cycle</strong>
          <p>
            {plan.shortfall.largestDriver} is the biggest driver. Steward will not reduce an
            obligation — trim a bucket, pause a goal, or dip into the buffer.
          </p>
        </section>
      )}

      {/* 3 — buckets. Budgeting stays visible on the most-viewed screen. */}
      <section className="sw-block">
        <header className="sw-block-head">
          <h2>Your buckets</h2>
          <span>{formatMoney(leftEveryday)} left</span>
        </header>
        <div className="sw-bucket-strip">
          {activity.map((entry) => (
            <button key={entry.bucket.id} className="sw-chip" onClick={() => onOpenBucket(entry.bucket)}>
              <span className="sw-chip-name">{entry.bucket.name}</span>
              <strong>{formatMoney(Math.max(0, entry.remaining))}</strong>
              <Bar percent={entry.percent} tone={entry.percent > 100 ? "amber" : entry.hot ? "amber" : "green"} />
              <small>{Math.round(entry.percent)}% used</small>
            </button>
          ))}
          {!activity.length && <Empty title="No buckets yet" body="Add everyday categories in Ledger." />}
        </div>
      </section>

      {/* 4 — progress. The emotional payload the previous build had none of. */}
      <section className="sw-block">
        <header className="sw-block-head">
          <h2>Progress</h2>
          <button className="sw-link" onClick={onGoPath}>
            Path <ArrowRight size={13} />
          </button>
        </header>
        {progress.length ? (
          <ul className="sw-progress">
            {progress.map((entry) => (
              <li key={entry.claim.id}>
                <div>
                  <strong>{entry.claim.name}</strong>
                  <small>
                    {formatMoney(entry.claim.fundedAmount)} of {formatMoney(entry.claim.targetAmount)}
                    {entry.arrivalDate ? ` · ${formatDate(entry.arrivalDate)}` : " · more than a year out"}
                  </small>
                </div>
                <Bar percent={entry.percent} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Nothing funded yet" body="Add something you're working toward and Steward will start funding it." />
        )}
      </section>

      {/* 5 — next obligation, with its reserve state. */}
      {nextReserve && (
        <section className="sw-block">
          <header className="sw-block-head"><h2>Coming up</h2></header>
          <div className="sw-row">
            <div>
              <strong>{nextReserve.bucket.name}</strong>
              <small>
                {formatMoney(nextReserve.bucket.reserved ?? 0)} of {formatMoney(nextReserve.bucket.amountDue ?? 0)} reserved ·
                due {formatDate(nextReserve.bucket.dueDate ?? null)}
              </small>
            </div>
            <b>{formatMoney(nextReserve.required)}<em>this cycle</em></b>
          </div>
        </section>
      )}

      {/* 6 — at most one insight, and only with evidence behind it. */}
      {insights.slice(0, 1).map((insight) => (
        <section className={`sw-insight ${insight.tone}`} key={insight.id}>
          <Sparkles size={15} />
          <div>
            <strong>{insight.headline}</strong>
            <p>{insight.detail}</p>
            <ul>{insight.evidence.map((row) => <li key={row}>{row}</li>)}</ul>
          </div>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- PATH ----- */

function PathScreen({
  workspace,
  today,
  update,
}: {
  workspace: Workspace;
  today: string;
  update: (next: (current: Workspace) => Workspace) => void;
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
  const today = todayISO(fixedToday);

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

      <main className="sw-main">
        {tab === "now" && (
          <NowScreen
            workspace={workspace}
            today={today}
            onOpenBucket={(bucket) => {
              setFocusBucket(bucket);
              setTab("ledger");
            }}
            onGoPath={() => setTab("path")}
          />
        )}
        {tab === "path" && <PathScreen workspace={workspace} today={today} update={update} />}
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
    </div>
  );
}

/* Referenced by the nav icons above; kept to avoid unused-import churn. */
export const icons = { CreditCard, Landmark, TrendingDown };
