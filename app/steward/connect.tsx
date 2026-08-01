"use client";

/**
 * CONNECT — the first screen.
 *
 * Immersive, not a card. One statement, one action.
 *
 * The previous rebuild put a centered white panel on a grey canvas, which read
 * as a SaaS signup rather than the start of something. This restores the
 * full-bleed green language: the app fills the device, the type is large and
 * quiet, and there is exactly one thing to do.
 *
 * Connecting is the real path — it is how Steward derives the budget rather
 * than asking the user to invent one. "Set it up myself" stays as a fallback so
 * a bank failure can never trap anyone, but it is deliberately secondary.
 */

import { Landmark, RefreshCw } from "lucide-react";
import type { PlaidStatus } from "./use-plaid";
import "./connect.css";

export function ConnectScreen({
  status,
  error,
  onConnect,
  onManual,
}: {
  status: PlaidStatus;
  error: string;
  onConnect: () => void;
  onManual: () => void;
}) {
  const busy = status !== "idle";
  const label =
    status === "opening"
      ? "Opening secure connection…"
      : status === "importing"
        ? "Saving your accounts…"
        : status === "syncing"
          ? "Reading your transactions…"
          : "Connect your bank";

  return (
    <main className="cx-screen">
      <header className="cx-top">
        <span className="cx-mark" aria-hidden="true" />
        <strong>Steward</strong>
      </header>

      <div className="cx-copy">
        <h1>Let&apos;s see where your money actually goes.</h1>
        <p>
          Connect once. Steward reads your last few months, works out what you spend and what
          you owe, and builds the plan from there.
        </p>
      </div>

      <footer className="cx-action">
        {error && (
          <p className="cx-error" role="alert">
            {error}
          </p>
        )}
        <button onClick={onConnect} disabled={busy}>
          {busy ? <RefreshCw size={18} className="cx-spin" /> : <Landmark size={18} />}
          {label}
        </button>
        <button className="cx-secondary" onClick={onManual} disabled={busy}>
          Set it up myself
        </button>
        <small>
          Handled by Plaid, never Steward. Read-only — Steward can&apos;t move money.
        </small>
      </footer>
    </main>
  );
}
