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
import { formatDate, formatMoney, planCycle, allocate } from "../../lib/model/engine";
import type { Workspace } from "../../lib/model/types";
import "./buckets.css";

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
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<"everyday" | "bill" | "goal" | "project">("everyday");
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  const { rows, income } = useMemo(() => {
    const plan = planCycle(workspace, today);
    if (!plan) return { rows: [] as Row[], income: 0 };
    const allocation = allocate(workspace, plan.freeCapacity, today);
    const amountFor = (claimId: string) =>
      allocation.allocations.find((entry) => entry.claim.id === claimId)?.amount ?? 0;

    const result: Row[] = [];

    for (const entry of plan.reserves) {
      const isDebt = Boolean(entry.bucket.linkedDebtAccountId);
      result.push({
        id: entry.bucket.id,
        name: entry.bucket.name,
        amount: entry.required,
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

    for (const claim of workspace.claims.filter((c) => c.status === "active")) {
      const amount = amountFor(claim.id);
      result.push({
        id: claim.id,
        name: claim.name,
        amount,
        detail:
          amount > 0
            ? `${formatMoney(claim.fundedAmount)} of ${formatMoney(claim.targetAmount)} so far`
            : "starts a later paycheck",
        kind: claim.kind === "payoff" ? "debt" : claim.projectId ? "project" : "goal",
        editable: true,
      });
    }

    return { rows: result, income: plan.income };
  }, [workspace, today]);

  /** A connected account is the only evidence Steward actually read anything. */
  const fromBank = workspace.accounts.length > 0;

  const assigned = rows.reduce((sum, row) => sum + row.amount, 0);
  const share = (amount: number) => (income > 0 ? (amount / income) * 100 : 0);

  const rename = (row: Row, name: string) => {
    update((current) => ({
      ...current,
      buckets: current.buckets.map((b) => (b.id === row.id ? { ...b, name } : b)),
      claims: current.claims.map((c) => (c.id === row.id ? { ...c, name } : c)),
    }));
  };

  const resize = (row: Row, amount: number) => {
    update((current) => ({
      ...current,
      buckets: current.buckets.map((b) =>
        b.id === row.id
          ? b.kind === "spend"
            ? { ...b, perCycle: amount }
            : { ...b, amountDue: amount }
          : b,
      ),
      claims: current.claims.map((c) => (c.id === row.id ? { ...c, pinned: amount } : c)),
    }));
  };

  const remove = (row: Row) => {
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
                Every paycheck has to cover these. Change anything that looks wrong — this is a
                starting point, not a verdict.
              </p>
            </>
          ) : (
            <>
              <span className="bk-eyebrow">From what you told me</span>
              <h1>Here&apos;s your starting plan.</h1>
              <p>
                Every paycheck has to cover these. Add anything that&apos;s missing — connecting a
                bank later fills in the rest from what you actually spend.
              </p>
            </>
          )
        ) : (
          <>
            <span className="bk-eyebrow">Every paycheck</span>
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
                        <span>$</span>
                        <input
                          type="number"
                          defaultValue={Math.round(row.amount)}
                          onBlur={(event) => resize(row, Number(event.target.value))}
                          aria-label={`Amount for ${row.name}`}
                        />
                      </label>
                      <div className="bk-edit-actions">
                        <button
                          className="bk-icon confirm"
                          onClick={() => {
                            if (draft.trim()) rename(row, draft.trim());
                            setEditing(null);
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
                          }}
                          aria-label={`Edit ${row.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </>
                  )}
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
