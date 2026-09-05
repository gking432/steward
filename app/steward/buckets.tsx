"use client";

/**
 * ALL BUCKETS — every claim on this paycheck, in one place.
 *
 * This screen exists twice over:
 *
 *   review mode  — straight after import, showing what Steward worked out from
 *                  the user's transactions, for them to approve or change
 *   plan mode    — the permanent home of the full picture
 *
 * They are the same component because they are the same information. The
 * previous rebuild scattered this across three tabs and never showed everything
 * at once, which failed the requirement outright.
 *
 * Grouping is Bills / Everyday / Goals / Projects / Debt — the user's language,
 * not the model's. Every row carries an assigned amount and a share of the
 * paycheck, because "what percentage of my money is this" is the question the
 * grouping exists to answer.
 */

import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate, formatMoney, planCycle, allocate, steadyFreeCapacity } from "../../lib/model/engine";
import type { Workspace } from "../../lib/model/types";
import "./buckets.css";
import { buildPaydayProposal } from "../../lib/model/decide";
import { editPlanRow, reorderGoal } from "../../lib/model/commands";

type Row = {
  id: string;
  name: string;
  amount: number;
  detail: string;
  kind: "bill" | "everyday" | "goal" | "project" | "debt";
  editable: boolean;
};

const GROUPS: { key: Row["kind"]; label: string; note: string }[] = [
  { key: "bill", label: "Bills", note: "Set aside before anything else" },
  { key: "debt", label: "Debt", note: "Minimums, plus what you're paying down" },
  { key: "everyday", label: "Everyday", note: "What you spend between paychecks" },
  { key: "goal", label: "Goals", note: "What you're saving toward" },
  { key: "project", label: "Projects", note: "Things you're building" },
];

export function BucketsScreen({
  workspace,
  today,
  mode,
  onApprove,
  update,
}: {
  workspace: Workspace;
  today: string;
  mode: "review" | "plan";
  onApprove?: () => void;
  update: (next: (current: Workspace) => Workspace) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [amountDraft, setAmountDraft] = useState("");
  const [targetDraft,setTargetDraft] = useState("");
  const [goalDate,setGoalDate] = useState("");
  const [goalStatus,setGoalStatus] = useState<Workspace["claims"][number]["status"]>("active");
  const [dueDraft, setDueDraft] = useState("");
  const [reservedDraft, setReservedDraft] = useState("");
  const [frequencyDraft, setFrequencyDraft] = useState<Workspace["buckets"][number]["frequency"]>("monthly");
  const [editError, setEditError] = useState("");
  const [usual, setUsual] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<"everyday" | "bill" | "goal" | "project">("everyday");
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  const { rows, income } = useMemo(() => {
    const plan = planCycle(workspace, today);
    if (!plan) return { rows: [] as Row[], income: 0 };
    const allocation = allocate(workspace, usual ? steadyFreeCapacity(workspace) : plan.freeCapacity, today);
    const allocationLines = usual ? allocation.allocations : buildPaydayProposal(workspace,today)?.lines ?? [];
    const amountFor = (claimId: string) =>
      allocationLines.find((entry) => entry.claim.id === claimId)?.amount ?? 0;

    const result: Row[] = [];

    for (const entry of plan.reserves) {
      const isDebt = Boolean(entry.bucket.linkedDebtAccountId);
      result.push({
        id: entry.bucket.id,
        name: entry.bucket.name,
        amount: usual ? entry.steadyRate : entry.required,
        detail:
          entry.cyclesRemaining > 1
            ? `${formatMoney(entry.bucket.amountDue ?? 0)} due ${formatDate(entry.bucket.dueDate!)} · split over ${entry.cyclesRemaining} paychecks`
            : `${formatMoney(entry.bucket.amountDue ?? 0)} due ${entry.bucket.dueDate ? formatDate(entry.bucket.dueDate) : "this cycle"}`,
        kind: isDebt ? "debt" : "bill",
        editable: !isDebt,
      });
    }

    for (const entry of plan.spend) {
      result.push({
        id: entry.bucket.id,
        name: entry.bucket.name,
        amount: entry.amount,
        detail: "each paycheck",
        kind: "everyday",
        editable: true,
      });
    }

    for (const claim of [...workspace.claims].sort((a,b)=>a.rank-b.rank)) {
      const amount = amountFor(claim.id);
      result.push({
        id: claim.id,
        name: claim.name,
        amount,
        detail:
          claim.status !== "active" ? `${claim.status} · ${formatMoney(claim.fundedAmount)} earmarked · not receiving money` : claim.openEnded ? `${formatMoney(claim.fundedAmount)} earmarked · open-ended savings` : amount > 0
            ? `${formatMoney(claim.fundedAmount)} of ${formatMoney(claim.targetAmount)} earmarked`
            : "starts a later paycheck",
        kind: claim.kind === "payoff" ? "debt" : claim.projectId ? "project" : "goal",
        editable: true,
      });
    }

    if (!usual && plan.bufferTopUp > 0) result.push({id:"buffer",name:"Buffer top-up",amount:plan.bufferTopUp,detail:"Restore your cash floor",kind:"bill",editable:false});
    for (const c of plan.commitments) { const row=result.find(r=>r.id===c.claim.id);if(row) row.amount=c.amount; }
    return { rows: result, income: plan.income };
  }, [workspace, today, usual]);

  /** A connected account is the only evidence Steward actually read anything. */
  const fromBank = workspace.accounts.length > 0;

  const assigned = rows.reduce((sum, row) => sum + row.amount, 0);
  const share = (amount: number) => (income > 0 ? (amount / income) * 100 : 0);

  const saveDraft = (row: Row) => {
    try {
      const bucket = workspace.buckets.find(b => b.id === row.id);
      const next = editPlanRow(workspace, { id: row.id, name: draft, amount: Number(amountDraft), ...(bucket?.kind === "reserve" ? { dueDate: dueDraft, reserved: Number(reservedDraft), frequency: frequencyDraft } : {}) });
      const target=Number(targetDraft);
      if (!Number.isFinite(target) || target < 0) throw Error("Enter a valid goal target.");
      update(() => ({...next,claims:next.claims.map(c=>c.id===row.id ? {...c,targetAmount:target,openEnded:target===0&&c.kind==='fund',wantBy:goalDate||undefined,status:goalStatus} : c)}));
      setEditing(null);
      setEditError("");
    } catch (error) { setEditError((error as Error).message); }
  };

  const remove = (row: Row) => {
    setEditing(null);
    update((current) => ({
      ...current,
      buckets: current.buckets.filter((b) => b.id !== row.id),
      claims: current.claims.map((c) =>
        c.id === row.id ? { ...c, status: "someday" as const } : c,
      ),
    }));
  };

  const add = () => {
    const name = newName.trim();
    const amount = Number(newAmount);
    if (!name || !Number.isFinite(amount) || amount <= 0 || (newKind === "bill" && !newDueDate)) {
      return;
    }
    const stamp = Date.now().toString(36);
    update((current) => {
      if (newKind === "everyday") {
        return {
          ...current,
          buckets: [
            ...current.buckets,
            {
              id: `spend:custom-${stamp}`,
              kind: "spend" as const,
              name,
              category: name,
              essential: false,
              source: "manual" as const,
              perCycle: amount,
              rollover: "sweep" as const,
            },
          ],
        };
      }
      if (newKind === "bill") {
        return {
          ...current,
          buckets: [
            ...current.buckets,
            {
              id: `reserve:custom-${stamp}`,
              kind: "reserve" as const,
              name,
              essential: true,
              source: "manual" as const,
              amountDue: amount,
              dueDate: newDueDate,
              reserved: 0,
              frequency: "monthly" as const,
              autopay: false,
            },
          ],
        };
      }

      const projectId = newKind === "project" ? `project:custom-${stamp}` : undefined;
      return {
        ...current,
        projects: projectId
          ? [...current.projects, { id: projectId, name }]
          : current.projects,
        claims: [
          ...current.claims,
          {
            id: `claim:custom-${stamp}`,
            name,
            kind: newKind === "project" ? ("purchase" as const) : ("fund" as const),
            projectId,
            targetAmount: amount,
            fundedAmount: 0,
            rank: current.claims.filter((claim) => claim.status === "active").length,
            status: "active" as const,
            horizon: "arrival" as const,
            divisible: newKind !== "project",
            delayCost: { type: "none" as const },
            protected: false,
          },
        ],
      };
    });
    setAdding(false);
    setNewName("");
    setNewAmount("");
    setNewDueDate("");
    setNewKind("everyday");
  };

  return (
    <div className={mode === "review" ? "bk-screen review" : "bk-screen"}>
      <header className="bk-head">
        {mode === "review" ? (
          // Only claim to have read transactions when transactions were read.
          // On the manual path the user typed these numbers a moment ago, and
          // saying "here's what Steward found" would be a lie they can see.
          fromBank ? (
            <>
              <span className="bk-eyebrow">From your last few months</span>
              <h1>Here&apos;s what Steward found.</h1>
              <p>
                This paycheck has to cover these. Change anything that looks wrong — this is a
                starting point, not a verdict.
              </p>
            </>
          ) : (
            <>
              <span className="bk-eyebrow">From what you told me</span>
              <h1>Here&apos;s your starting plan.</h1>
              <p>
                This paycheck has to cover these. Add anything that&apos;s missing — connecting a
                bank later fills in the rest from what you actually spend.
              </p>
            </>
          )
        ) : (
          <>
            <span className="bk-eyebrow">This paycheck</span>
            <h1>Your plan</h1>
          </>
        )}
        <div className="bk-total">
          <div>
            <small>Paycheck</small>
            <strong>{formatMoney(income)}</strong>
          </div>
          <div>
            <small>Assigned</small>
            <strong>{formatMoney(assigned)}</strong>
          </div>
          <div>
            <small>Left over</small>
            <strong className={income - assigned < 0 ? "over" : ""}>
              {formatMoney(income - assigned)}
            </strong>
          </div>
        </div>
      </header>

      <div role="group" aria-label="Plan period"><button aria-pressed={!usual} onClick={() => setUsual(false)}>This paycheck</button><button aria-pressed={usual} onClick={() => setUsual(true)}>Usual plan</button></div>
      <p>Amounts are planned contributions. Bills show the full obligation separately. Catch-up needs can exceed your usual contribution.</p>
      <div className="bk-groups">
        {GROUPS.map((group) => {
          const groupRows = rows.filter((row) => row.kind === group.key);
          if (!groupRows.length) return null;
          const groupTotal = groupRows.reduce((sum, row) => sum + row.amount, 0);
          return (
            <section className="bk-group" key={group.key}>
              <header>
                <div>
                  <h2>{group.label}</h2>
                  <small>{group.note}</small>
                </div>
                <div className="bk-group-total">
                  <strong>{formatMoney(groupTotal)}</strong>
                  <small>{Math.round(share(groupTotal))}% of your pay</small>
                </div>
              </header>

              {groupRows.map((row) => (
                <article className="bk-row" key={row.id}>
                  {editing === row.id ? (
                    <div className="bk-edit">
                      <input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        aria-label={`Rename ${row.name}`}
                      />
                      <label>
                        <span>{workspace.buckets.find(b => b.id === row.id)?.kind === "reserve" ? "Full bill ($)" : "Contribution ($)"}</span>
                        <input
                          type="number"
                          min="0" step="0.01"
                          value={amountDraft}
                          onChange={(event) => setAmountDraft(event.target.value)}
                          aria-label={`Amount for ${row.name}`}
                        />
                      </label>
                      {workspace.buckets.find(b => b.id === row.id)?.kind === "reserve" && <>
                        <label>Due date<input type="date" value={dueDraft} onChange={e => setDueDraft(e.target.value)} /></label>
                        <label>Already reserved<input type="number" min="0" step="0.01" value={reservedDraft} onChange={e => setReservedDraft(e.target.value)} /></label>
                        <label>Frequency<select value={frequencyDraft} onChange={e => setFrequencyDraft(e.target.value as typeof frequencyDraft)}>{["monthly", "weekly", "biweekly", "annual", "one-time"].map(f => <option key={f}>{f}</option>)}</select></label>
                        <p>Current contribution: {formatMoney(row.amount)}. Saving recalculates your plan; no payment is made.</p>
                      </>}
                      {workspace.claims.some(c=>c.id===row.id) && <>
                        <label>Goal target (0 for open-ended savings)<input type="number" min="0" step="0.01" value={targetDraft} onChange={e=>setTargetDraft(e.target.value)}/></label>
                        <label>Desired date<input type="date" value={goalDate} onChange={e=>setGoalDate(e.target.value)}/></label>
                        <label>Status<select value={goalStatus} onChange={e=>setGoalStatus(e.target.value as typeof goalStatus)}>{["active","someday","paused","complete"].map(status=><option key={status}>{status}</option>)}</select></label>
                      </>}
                      {(() => {try { const next=editPlanRow(workspace,{id:row.id,name:draft,amount:Number(amountDraft),dueDate:dueDraft||undefined,reserved:Number(reservedDraft),frequency:frequencyDraft});const nextPlan=planCycle(next,today); const reserve=nextPlan?.reserves.find(r=>r.bucket.id===row.id);return <p>After Save: {reserve ? `${formatMoney(reserve.required)} this paycheck; ` : ''}{formatMoney(nextPlan?.freeCapacity??0)} available for goals.</p>;}catch{return null;}})()}
                      {editError && <p role="alert">{editError}</p>}
                      <div className="bk-edit-actions">
                        <button onClick={() => setEditing(null)}>Cancel</button>
                        <button
                          className="bk-icon confirm"
                          onClick={() => {
                            saveDraft(row);
                          }}
                          aria-label="Save"
                        >
                          <Check size={15} />
                        </button>
                        <button className="bk-icon" onClick={() => remove(row)} aria-label={`Remove ${row.name}`}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="bk-row-main">
                        <strong>{row.name}</strong>
                        <small>{row.detail}</small>
                      </div>
                      <div className="bk-row-amount">
                        <strong>{formatMoney(row.amount)}</strong>
                        <small>{Math.round(share(row.amount))}%</small>
                      </div>
                      {row.editable && (
                        <button
                          className="bk-icon"
                          onClick={() => {
                            setEditing(row.id);
                            setDraft(row.name);
                            const bucket = workspace.buckets.find(b => b.id === row.id);
                            const claim = workspace.claims.find(c => c.id === row.id);
                            setTargetDraft(String(claim?.targetAmount??0));setGoalDate(claim?.wantBy??"");setGoalStatus(claim?.status??"active");
                            setAmountDraft(String(bucket?.kind === "reserve" ? bucket.amountDue ?? 0 : claim?.pinned ?? row.amount));
                            setDueDraft(bucket?.dueDate ?? "");
                            setReservedDraft(String(bucket?.reserved ?? 0));
                            setFrequencyDraft(bucket?.frequency ?? "monthly");
                            setEditError("");
                          }}
                          aria-label={`Edit ${row.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </>
                  )}
                  {workspace.claims.some(c => c.id === row.id) && <div className="bk-edit-actions"><button onClick={() => update(w => reorderGoal(w, row.id, -1))} aria-label={`Raise priority of ${row.name}`}>↑ Priority</button><button onClick={() => update(w => reorderGoal(w, row.id, 1))} aria-label={`Lower priority of ${row.name}`}>↓ Priority</button></div>}
                  <div className="bk-bar">
                    <span style={{ width: `${Math.min(100, share(row.amount) * 2)}%` }} />
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>

      {mode === "review" && (
        <footer className="bk-approve">
          <button className="bk-primary" onClick={onApprove}>
            Looks right <ChevronDown size={16} style={{ transform: "rotate(-90deg)" }} />
          </button>
          <small>You can change any of it later.</small>
        </footer>
      )}

      {mode === "plan" && (
        adding ? (
          <section className="bk-new" aria-label="Add to your plan">
            <header>
              <div>
                <span className="bk-eyebrow">Add to your plan</span>
                <h2>What kind of money is this?</h2>
              </div>
              <button className="bk-icon" onClick={() => setAdding(false)} aria-label="Cancel adding bucket">
                <X size={16} />
              </button>
            </header>
            <div className="bk-kind" role="group" aria-label="Bucket type">
              {(["everyday", "bill", "goal", "project"] as const).map((kind) => (
                <button
                  key={kind}
                  className={newKind === kind ? "active" : ""}
                  onClick={() => setNewKind(kind)}
                >
                  {kind === "everyday" ? "Everyday" : kind[0].toUpperCase() + kind.slice(1)}
                </button>
              ))}
            </div>
            <label>
              <span>Name</span>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Gym, dog care, new laptop…" />
            </label>
            <label>
              <span>{newKind === "everyday" ? "Each paycheck" : newKind === "bill" ? "Monthly amount" : "Target amount"}</span>
              <input type="number" inputMode="decimal" value={newAmount} onChange={(event) => setNewAmount(event.target.value)} placeholder="0" />
            </label>
            {newKind === "bill" && (
              <label>
                <span>Next due date</span>
                <input type="date" value={newDueDate} onChange={(event) => setNewDueDate(event.target.value)} />
              </label>
            )}
            <button className="bk-primary" onClick={add}>Add to plan</button>
          </section>
        ) : (
          <button className="bk-add" onClick={() => setAdding(true)}>
            <Plus size={15} /> Add a bucket
          </button>
        )
      )}
    </div>
  );
}
