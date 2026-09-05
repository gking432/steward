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
  Check,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Landmark,
  ListChecks,
  Receipt,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  bucketActivity,
  currentCycle,
  formatDate,
  formatMoney,
  planCycle,
} from "../../lib/model/engine";
import {
  buildPaydayProposal,
  claimFromPurchase,
  confirmProposal,
  debtDetail,
  evaluatePurchase,
  recategorize,
  supersedeStaleProposals,
  type PaydayProposal,
  type Verdict,
} from "../../lib/model/decide";
import { fallbackIntent, type IntentDraft } from "../../lib/model/ai";
import { spendingByCategory } from "../../lib/model/observations";
import type { Bucket, Claim, Workspace } from "../../lib/model/types";
import type { StewardState } from "../../lib/steward-types";
import { BucketsScreen } from "./buckets";
import { ConnectScreen } from "./connect";
import { Modal } from "./dialog";
import { OnboardingConversation } from "./onboarding-conversation";
import { ConversationSetup } from "./conversation-setup";
import { clearPlanningDrafts, type SessionIntent } from "../../lib/model/planning-session";
import { HomeScreen } from "./home";
import { SettingsSheet } from "./settings";
import { SplitSheet } from "./split";
import { usePlaidConnect } from "./use-plaid";
import { useWorkspace } from "./workspace-store";
import "./steward.css";

type Tab = "home" | "plan" | "activity";

const todayISO = (fixed?: string) => fixed ?? new Date().toISOString().slice(0, 10);

function DemoStatementImport({
  workspace,
  today,
  onContinue,
}: {
  workspace: Workspace;
  today: string;
  onContinue: () => void;
}) {
  const categories=spendingByCategory(workspace,today);
  return <main className="dm-screen dm-review"><header className="dm-top"><strong>Steward</strong><span>Synthetic statement overview</span></header><section className="dm-review-copy"><h1>A starting point you can inspect.</h1><p>{workspace.transactions.length} synthetic transactions across {workspace.accounts.length} sample accounts. These are deterministic summaries of sample records.</p></section><section className="dm-findings">{categories.map(c=><article key={c.category}><span><strong>{c.category}</strong><small>{c.merchants.slice(0,2).join(' · ')}</small></span><b>{formatMoney(c.total)}<small>observed total</small></b></article>)}</section><footer className="dm-action"><button onClick={onContinue}>Continue to the planning session</button></footer></main>;
}

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

/* ----------------------------------------------------------- LEDGER ----- */

function LedgerScreen({
  workspace,
  today,
  focusBucket,
  clearFocus,
  update,
  onSplit,
}: {
  workspace: Workspace;
  today: string;
  focusBucket: Bucket | null;
  clearFocus: () => void;
  update: (next: (current: Workspace) => Workspace) => void;
  onSplit: (transactionId: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [search,setSearch] = useState("");
  const [accountFilter,setAccountFilter] = useState("");
  const [dateFrom,setDateFrom] = useState("");
  const [dateTo,setDateTo] = useState("");
  const [undoCategory,setUndoCategory] = useState<Workspace | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const cycle = currentCycle(workspace, today);
  const plan = planCycle(workspace, today);
  const [open, setOpen] = useState<string | null>(focusBucket?.id ?? null);
  const categories = Array.from(
    new Set([
      ...workspace.buckets.filter((b) => b.kind === "spend").map((b) => b.category ?? b.name),
      ...workspace.transactions.filter((t) => t.type === "expense").map((t) => t.category),
    ]),
  ).filter((category) => Boolean(category) && category !== "Uncategorized").sort();

  /**
   * Correcting a category is the whole promise of Ledger: you can see where
   * money went AND fix it when Steward got it wrong. Remembering applies the
   * same category to every transaction from that merchant, so the numbers all
   * move at once and the correction is visibly worth making.
   */
  const correct = (transactionId: string, category: string, remember: boolean) => {
    setUndoCategory(workspace);
    update((current) => recategorize(current, transactionId, category, remember));
    setEditing(null);
  };

  if (!cycle || !plan) return <Empty title="No cycle" body="Add your pay schedule first." />;

  const rows = workspace.transactions.filter(row => (!search || row.merchant.toLowerCase().includes(search.toLowerCase())) && (!accountFilter || row.accountId === accountFilter) && row.date >= (dateFrom || cycle.start) && (dateTo ? row.date <= dateTo : row.date < cycle.end));
  const income = rows.filter((row) => !row.excluded && row.type === "income").reduce((sum, row) => sum + row.amount, 0);
  const out = rows.filter((row) => !row.excluded && row.type === "expense").reduce((sum, row) => sum + row.amount, 0);
  const spendBuckets = workspace.buckets.filter((bucket) => bucket.kind === "spend");

  return (
    <div className="sw-screen sw-ledger-screen">
      <section className="sw-position compact">
        <span className="sw-eyebrow">
          This paycheck · {formatDate(cycle.start)} – {formatDate(cycle.end)}
        </span>
        <div className="sw-inout">
          <div><small>In</small><strong>{formatMoney(income)}</strong></div>
          <div><small>Spent</small><strong>{formatMoney(out)}</strong></div>
          <div><small>Bills planned</small><strong>{formatMoney(plan.reservesTotal)}</strong></div>
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
          <div><dt>Bills &amp; minimums planned</dt><dd>−{formatMoney(plan.reservesTotal)}</dd></div>
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
                          <small>{formatDate(row.date)}</small>
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
                {formatMoney(entry.required)} planned this paycheck · {formatMoney(entry.bucket.amountDue ?? 0)} total
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
        <div className="activity-filters"><label>Merchant<input value={search} onChange={e=>setSearch(e.target.value)}/></label><label>Account<select value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="">All accounts</option>{workspace.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label>From<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label><label>Through<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label></div>
        {undoCategory && <button onClick={()=>{update(current=>({...current,transactions:undoCategory.transactions,rules:undoCategory.rules}));setUndoCategory(null);}}>Undo last categorization</button>}
        <p className="sw-muted">Remembering a merchant applies to matching history and future imports. Splits retain their category portions.</p>
        {rows.length===0 && <p>No matching activity. Clear the merchant, account or dates to broaden your search.</p>}
        <div className="sw-tx-list">
          {[...rows].sort((a, b) => b.date.localeCompare(a.date)).map((row) => (
            <div key={row.id}>
              <button
                className={row.needsReview ? "sw-tx needs-review" : "sw-tx"}
                onClick={() => {
                  if (row.type !== "expense") return;
                  const opening = editing !== row.id;
                  setEditing(opening ? row.id : null);
                  setCategoryDraft(opening && row.category !== "Uncategorized" ? row.category : "");
                }}
                aria-expanded={row.type === "expense" ? editing === row.id : undefined}
              >
                <span className="sw-tx-mark">{row.merchant.slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{row.merchant}</strong>
                  <small>
                    {row.category} · {formatDate(row.date)} · {row.excluded ? "Excluded" : row.pending ? "Pending" : "Posted"} · {row.type}
                    {row.needsReview ? " · needs a category" : ""}
                  </small>
                </div>
                <b className={row.type === "income" ? "pos" : ""}>
                  {row.type === "income" ? "+" : "−"}{formatMoney(row.amount)}
                </b>
              </button>
              {editing === row.id && (
                <div className="sw-correct">
                  <span className="sw-eyebrow">Put this in</span>
                  <div className="sw-correct-options">
                    {categories.map((category) => (
                      <button
                        key={category}
                        className={category === categoryDraft ? "sw-pick active" : "sw-pick"}
                        onClick={() => setCategoryDraft(category)}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                  <button
                    className="sw-secondary"
                    disabled={!categoryDraft || categoryDraft === row.category}
                    onClick={() => correct(row.id, categoryDraft, false)}
                  >
                    Change this transaction
                  </button>
                  <button
                    className="sw-secondary"
                    disabled={!categoryDraft}
                    onClick={() => correct(row.id, categoryDraft, true)}
                  >
                    Always put {row.merchant} in {categoryDraft || "this category"}
                  </button>
                  <button className="sw-secondary" onClick={() => onSplit(row.id)}>
                    {row.split?.length
                      ? `Edit split · ${row.split.length} categories`
                      : "Split across categories"}
                  </button>
                </div>
              )}
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
    <Modal className="sw-sheet-backdrop" label="Can I buy this?" onClose={onClose}>
      <div className="sw-sheet"   aria-label="Can I buy this?" onMouseDown={(event) => event.stopPropagation()}>
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
              <input
                value={item}
                onChange={(event) => setItem(event.target.value)}
                placeholder="New tires, a flight home, a laptop…"
                autoFocus
              />
            </label>
            <label>
              <span>How much?</span>
              <input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" placeholder="0.00" />
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
    </Modal>
  );
}




/* ---------------------------------------------------------------- DEBT -- */

/**
 * Debt detail.
 *
 * The scenario control is the point: "what does an extra $50 buy me?" is the
 * question that actually keeps someone paying down a balance, and it is the
 * one every budgeting app leaves unanswered. Every figure is simulated by the
 * engine on the stored APR — when there is no APR, Steward says so instead of
 * printing a date it cannot defend.
 */
function DebtSheet({
  workspace,
  claimId,
  today,
  onClose,
  update,
}: {
  workspace: Workspace;
  claimId: string;
  today: string;
  onClose: () => void;
  update: (next: (current: Workspace) => Workspace) => void;
}) {
  const detail = debtDetail(workspace, claimId, today);
  if (!detail) return null;

  const pin = (amount: number) =>
    update((current) => ({
      ...current,
      claims: current.claims.map((claim) =>
        claim.id === claimId ? { ...claim, pinned: amount } : claim,
      ),
    }));

  const percentPaid =
    detail.claim.targetAmount > 0
      ? (detail.claim.fundedAmount / detail.claim.targetAmount) * 100
      : 0;

  return (
    <Modal className="sw-sheet-backdrop" label="Debt details" onClose={onClose}>
      <div className="sw-sheet"   aria-label={detail.claim.name}
        onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <h2>{detail.claim.name}</h2>
          <button onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>

        <div className="sw-verdict">
          <div>
            <span className="sw-eyebrow">Still owed</span>
            <strong className="sw-huge">{formatMoney(detail.balance)}</strong>
            <Bar percent={percentPaid} tone="slate" />
            <p className="sw-muted">
              {formatMoney(detail.claim.fundedAmount)} paid down ·{" "}
              {detail.apr === null ? "no rate on file" : `${detail.apr.toFixed(2)}% APR`}
            </p>
          </div>

          {detail.minimum > 0 && (
            <p className="sw-note">
              The {formatMoney(detail.minimum)} minimum is already handled in your bills. This is
              the extra on top.
            </p>
          )}

          {detail.apr === null ? (
            <p className="sw-note">
              Add this account&apos;s interest rate and Steward can project a payoff date. It
              won&apos;t guess at one.
            </p>
          ) : (
            <>
              <span className="sw-eyebrow">What each pace costs</span>
              <div className="sw-scenarios">
                {[detail.current, ...detail.options].map((option, index) => {
                  const base = detail.current;
                  const saved = base.totalInterest - option.totalInterest;
                  return (
                    <button
                      key={option.perCycle}
                      className={index === 0 ? "sw-scenario current" : "sw-scenario"}
                      onClick={() => pin(option.perCycle)}
                    >
                      <strong>{formatMoney(option.perCycle)}<em>a paycheck</em></strong>
                      <span>
                        {option.beyondHorizon ? "over a year out" : formatDate(option.arrivalDate)}
                      </span>
                      <small>
                        {index === 0
                          ? "your current pace"
                          : saved > 0
                            ? `saves ${formatMoney(saved)} in interest`
                            : "no interest saved"}
                      </small>
                    </button>
                  );
                })}
              </div>
              <p className="sw-muted sw-fineprint">
                Projected on the rate on file. Rates, minimums and fees can change — check your
                statement. Educational planning information, not financial advice.
              </p>
            </>
          )}
        </div>
      </div>
    </Modal>
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
    <Modal className="sw-sheet-backdrop" label="Add something" onClose={onClose}>
      <div className="sw-sheet"   aria-label="Add something"
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
                placeholder="I want $2,000 saved for emergencies"
                autoFocus
              />
            </label>
            <p className="sw-muted">
              &ldquo;I want this credit card gone&rdquo; · &ldquo;$800 for car repairs&rdquo; ·
              &ldquo;save for a trip home&rdquo;
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
    </Modal>
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
    <Modal className="sw-sheet-backdrop" label="Payday" onClose={onDismiss}>
      <div className="sw-sheet sw-payday"   aria-label="Payday">
        <header>
          <h2>Payday</h2>
          <button onClick={onDismiss} aria-label="Close"><X size={18} /></button>
        </header>

        {step === 0 && (
          <div className="sw-payday-step">
            <span className="sw-eyebrow">Expected paycheck</span>
            <strong className="sw-huge">{formatMoney(proposal.income)}</strong>
            <p className="sw-sub">Let&apos;s put it to work.</p>
            <button className="sw-primary" onClick={() => setStep(1)}>Continue</button>
          </div>
        )}

        {step === 1 && (
          <div className="sw-payday-step">
            <span className="sw-eyebrow">Planned obligations</span>
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
                    <em>{line.completes ? "complete" : line.claim.openEnded ? "open-ended" : line.arrival ? formatDate(line.arrival) : "date unavailable"}</em>
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
              Nothing is assigned to your goals until you confirm. Bills and minimums are planned, not proof of payment. No bank transfer is made.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}


/* --------------------------------------------------------------- SHELL -- */

export function StewardApp({
  initialState,
  syncWithServer = true,
  fixedToday,
  demoMode = false,
  manualMode = false,
  showStatementImport = false,
}: {
  initialState: StewardState;
  syncWithServer?: boolean;
  fixedToday?: string;
  demoMode?: boolean;
  manualMode?: boolean;
  showStatementImport?: boolean;
}) {
  const { workspace, update, loading, saveState, setWorkspaceFromServer, retrySave } = useWorkspace(
    initialState,
    syncWithServer,
  );
  const [tab, setTab] = useState<Tab>("home");
  const [buyOpen, setBuyOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [sessionIntent,setSessionIntent]=useState<SessionIntent>("priority");
  const [splitting, setSplitting] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusBucket, setFocusBucket] = useState<Bucket | null>(null);
  const [reviewRequested,setReviewRequested] = useState(false);
  const [paydayDismissed, setPaydayDismissed] = useState(demoMode);
  const [addOpen, setAddOpen] = useState(false);
  const [debtClaimId, setDebtClaimId] = useState<string | null>(null);
  const [demoStatementsReviewed, setDemoStatementsReviewed] = useState(false);
  const plaid = usePlaidConnect(setWorkspaceFromServer);
  const today = todayISO(fixedToday);

  const proposal = useMemo(
    () => buildPaydayProposal(workspace, today),
    [workspace, today],
  );
  // Shown when a cycle has money to direct and has not been confirmed. Closing
  // it writes nothing; the plan stays pending until the next cycle supersedes it.
  const paydayDue =
    !!proposal && (reviewRequested || (!proposal.confirmed && proposal.freeCapacity > 0 && !paydayDismissed));

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
    return <div className="sw-boot"><div className="sw-boot-mark" /><span role="status">Loading your private workspace…</span><a href="/fixture">Explore a sample plan</a><a href="/manual">Build a manual plan</a></div>;
  }

  // First run, in three states.
  //
  //   no data                 → Connect. The live bank path is visible but
  //                             unavailable in this portfolio build.
  //   data, not yet approved  → the buckets Steward worked out, for review.
  //   approved                → the app.
  //
  if (!hasData && !manualMode) {
    return (
      <ConnectScreen />
    );
  }

  if (showStatementImport && demoMode && hasData && !workspace.profile.onboardingComplete && !demoStatementsReviewed) {
    return (
      <DemoStatementImport
        workspace={workspace}
        today={today}
        onContinue={() => setDemoStatementsReviewed(true)}
      />
    );
  }

  // The conversation is the front door, not a buckets screen to approve.
  // Steward asks what you want, says what it found, proposes a plan — and the
  // rest of the app opens only once you agree to it.
  if (!workspace.profile.onboardingComplete) {
    return (
      <OnboardingConversation workspace={workspace} today={today} onDone={(next) => update(() => next)} manual={manualMode}
      />
    );
  }

  if(askOpen)return <ConversationSetup key={sessionIntent} workspace={workspace} today={today} intent={sessionIntent} manual={manualMode} onCancel={()=>setAskOpen(false)} onDone={next=>{update(()=>next);setAskOpen(false);}}/>;

  return (
    <div className={`sw-app${demoMode ? " sw-demo-mode" : ""}`}>
      {demoMode && (
        <aside className="sw-demo-bar" aria-label="Demo mode">
          <span><strong>Demo · synthetic data · {today}</strong> · saved in this tab</span>
          <a href="/demo" onClick={() => {sessionStorage.removeItem("steward-demo:/fixture");sessionStorage.removeItem("steward-demo:/demo");clearPlanningDrafts(sessionStorage,"/demo");clearPlanningDrafts(sessionStorage,"/fixture");}}>Start over</a>
        </aside>
      )}
      {(saveState === "offline" || saveState === "conflict") && (
        <p className="sw-offline" role="status">
          {saveState === "conflict" ? "Another session changed this workspace. Export your draft in Settings, then reload to resolve the conflict." : "Unsaved session. Export in Settings before closing, or retry saving."}
          {saveState !== "conflict" && <button onClick={retrySave}>Retry save</button>}
        </p>
      )}

      {manualMode && <p role="status">Manual plan · stored in this browser tab only. Export in Settings before closing.</p>}
      {!demoMode && syncWithServer && <p role="status">{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Changes need attention"}</p>}
      <main className="sw-main-full">
        {tab === "home" && (
          <HomeScreen
            workspace={workspace}
            today={today}
            onOpenBuckets={() => setTab("plan")}
            onOpenBucket={(bucket) => {
              setFocusBucket(bucket);
              setTab("activity");
            }}
            onAsk={() => {setSessionIntent("priority");setAskOpen(true);}}
            onSession={intent=>{setSessionIntent(intent);setAskOpen(true);}}
            onSettings={() => setSettingsOpen(true)}
          />
        )}
        {tab === "plan" && <button className="sw-primary" onClick={()=>setReviewRequested(true)}>Review paycheck allocation</button>}
        {tab === "plan" && (
          <BucketsScreen workspace={workspace} today={today} mode="plan" update={update} />
        )}
        {tab === "activity" && (
          <LedgerScreen
            workspace={workspace}
            today={today}
            focusBucket={focusBucket}
            clearFocus={() => setFocusBucket(null)}
            update={update}
            onSplit={setSplitting}
          />
        )}
      </main>

      <nav className="sw-nav" aria-label="Main">
        <button className={tab === "home" ? "active" : ""} onClick={() => setTab("home")}>
          <Target size={19} /><span>Home</span>
        </button>
        <button className="sw-fab" onClick={() => setAskOpen(true)} aria-label="Ask Steward">
          <Sparkles size={21} />
        </button>
        <button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>
          <ListChecks size={19} /><span>Plan</span>
        </button>
        <button
          className={tab === "activity" ? "active" : ""}
          onClick={() => { setFocusBucket(null); setTab("activity"); }}
        >
          <Receipt size={19} /><span>Activity</span>
        </button>
      </nav>

      {settingsOpen && (
        <SettingsSheet
          bankSupported={syncWithServer}
          workspace={workspace}
          update={update}
          onClose={() => setSettingsOpen(false)}
          bankStatus={plaid.status}
          bankError={plaid.error}
          onConnectBank={plaid.connect}
          onSyncBanks={() => { void plaid.sync(); }}
          onReset={async () => {
            // Clear the stored workspace, then return to first run. Without
            // this there is no way back to Connect once anything is saved.
            if (!syncWithServer) {clearPlanningDrafts(sessionStorage,location.pathname);sessionStorage.removeItem('steward-demo:' + location.pathname);window.location.href=demoMode ? '/demo' : '/manual';return;}
            const response=await fetch("/api/steward", { method: "DELETE" });
            if(!response.ok) throw Error('Deletion failed');
            clearPlanningDrafts(sessionStorage,location.pathname);
            window.location.href='/';
          }}
        />
      )}

      {splitting && (() => {
        const row = workspace.transactions.find((entry) => entry.id === splitting);
        return row ? (
          <SplitSheet
            workspace={workspace}
            transaction={row}
            update={update}
            onClose={() => setSplitting(null)}
          />
        ) : null;
      })()}



      {buyOpen && (
        <BuySheet workspace={workspace} today={today} update={update} onClose={() => setBuyOpen(false)} />
      )}

      {debtClaimId && (
        <DebtSheet
          workspace={workspace}
          claimId={debtClaimId}
          today={today}
          update={update}
          onClose={() => setDebtClaimId(null)}
        />
      )}

      {addOpen && (
        <AddClaimSheet workspace={workspace} today={today} update={update} onClose={() => setAddOpen(false)} />
      )}

      {paydayDue && proposal && (
        <PaydayFlow
          workspace={workspace}
          proposal={proposal}
          update={update}
          onDismiss={() => {setPaydayDismissed(true);setReviewRequested(false);}}
          onConfirm={() => {
            update((current) =>
              confirmProposal(supersedeStaleProposals(current, proposal.cycleId), proposal),
            );
            setPaydayDismissed(true);setReviewRequested(false);
          }}
        />
      )}
    </div>
  );
}

/* Referenced by the nav icons above; kept to avoid unused-import churn. */
export const icons = { CreditCard, Landmark, TrendingDown };
