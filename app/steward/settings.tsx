"use client";

/**
 * SETTINGS.
 *
 * Small on purpose: the things a person genuinely needs to change, plus the
 * two they have a right to — take their data out, and delete it.
 *
 * Export and delete existed in the pre-redesign app and were lost when the
 * tree was replaced. That was a regression in something people are entitled
 * to, not a feature cut, and it should not have shipped missing.
 */

import { Download, LogOut, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { Workspace } from "../../lib/model/types";
import "./settings.css";

export function SettingsSheet({
  workspace,
  onClose,
  update,
  onReset,
}: {
  workspace: Workspace;
  onClose: () => void;
  update: (next: (current: Workspace) => Workspace) => void;
  onReset: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const download = (name: string, body: string, type: string) => {
    const url = URL.createObjectURL(new Blob([body], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () =>
    download(
      `steward-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(workspace, null, 2),
      "application/json",
    );

  const exportCsv = () => {
    const rows = [
      ["date", "merchant", "description", "amount", "category", "type"],
      ...workspace.transactions.map((row) => [
        row.date,
        row.merchant,
        row.description,
        String(row.amount),
        row.category,
        row.type,
      ]),
    ];
    download(
      "steward-transactions.csv",
      rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n"),
      "text/csv",
    );
  };

  const setProfile = (patch: Partial<Workspace["profile"]>) =>
    update((current) => ({ ...current, profile: { ...current.profile, ...patch } }));

  return (
    <div className="st-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="st-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <strong>Settings</strong>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <section>
          <h3>Your pay</h3>
          <label>
            <span>Take-home each paycheck</span>
            <input
              type="number"
              defaultValue={workspace.profile.takeHomePay}
              onBlur={(event) => setProfile({ takeHomePay: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>How often</span>
            <select
              value={workspace.profile.payFrequency}
              onChange={(event) =>
                setProfile({ payFrequency: event.target.value as Workspace["profile"]["payFrequency"] })
              }
            >
              <option>Weekly</option>
              <option>Biweekly</option>
              <option>Monthly</option>
            </select>
          </label>
          <label>
            <span>Next payday</span>
            <input
              type="date"
              defaultValue={workspace.profile.nextPayday}
              onBlur={(event) => setProfile({ nextPayday: event.target.value })}
            />
          </label>
          <label>
            <span>Cash you never want to dip below</span>
            <input
              type="number"
              defaultValue={workspace.profile.bufferFloor}
              onBlur={(event) => setProfile({ bufferFloor: Number(event.target.value) })}
            />
          </label>
        </section>

        <section>
          <h3>Your data</h3>
          <p>It&apos;s yours. Take a copy whenever you like.</p>
          <div className="st-row">
            <button onClick={exportJson}>
              <Download size={15} /> Everything (JSON)
            </button>
            <button onClick={exportCsv}>
              <Download size={15} /> Transactions (CSV)
            </button>
          </div>
        </section>

        <section className="st-danger">
          <h3>Start over</h3>
          {confirming ? (
            <>
              <p>
                This deletes your workspace and disconnects any bank. It can&apos;t be undone.
              </p>
              <div className="st-row">
                <button onClick={() => setConfirming(false)}>Cancel</button>
                <button className="st-delete" onClick={onReset}>
                  <Trash2 size={15} /> Delete everything
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => setConfirming(true)}>
              <LogOut size={15} /> Delete my data and start again
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
