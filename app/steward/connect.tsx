"use client";

/**
 * CONNECT — the first screen.
 *
 * Immersive, not a card. One statement, one action.
 *
 * The previous rebuild put a centered white panel on a grey canvas, which read
 * as a SaaS signup rather than the start of something. This restores the
 * full-bleed green language: the app fills the device and the type is large
 * and quiet.
 *
 * The portfolio demo keeps the real bank path visible but unavailable, then
 * offers a clearly labeled demo connection that runs through the full product.
 */

import { Landmark, Play } from "lucide-react";
import "./connect.css";

export function ConnectScreen() {
  return (
    <main className="cx-screen">
      <header className="cx-top">
        <span className="cx-mark" aria-hidden="true" />
        <strong>Steward</strong>
      </header>

      <div className="cx-copy">
        <h1>Let&apos;s see where your money actually goes.</h1>
        <p>
          Explore synthetic statements or build a manual plan. Real bank connections are unavailable on this demo deployment.
        </p>
      </div>

      <footer className="cx-action">
        <a className="cx-demo" href="/fixture">Explore a sample plan</a>
        <a className="cx-demo cx-secondary" href="/manual">Build a manual plan</a>
        <button className="cx-bank-disabled" disabled>
          <Landmark size={18} />
          <span>Connect your bank <small>Coming soon</small></span>
        </button>
        {/* A full navigation is intentional: the Sites runtime can retain the
            current RSC tree during a client transition between dynamic routes. */}
        <a className="cx-demo cx-secondary" href="/demo">
          <Play size={16} fill="currentColor" />
          Test demo mode
        </a>
        <small>
          Handled by Plaid, never Steward. Read-only — Steward can&apos;t move money.
        </small>
      </footer>
    </main>
  );
}
