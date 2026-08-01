"use client";

/**
 * Bank connection.
 *
 * Ported from the pre-redesign app so the new experience owns it outright and
 * Phase 10 can remove the legacy tree without losing the feature. The API
 * routes are unchanged — this is the same exchange and sync flow.
 *
 * Every failure path sets a message and returns to idle: a bank problem must
 * never trap someone in first run, because the manual path is always available.
 */

import { useCallback, useState } from "react";
import type { StewardState } from "../../lib/steward-types";

declare global {
  interface Window {
    Plaid?: {
      create(config: {
        token: string;
        onSuccess: (
          publicToken: string,
          metadata: { institution?: { institution_id?: string; name?: string } },
        ) => void;
        onExit?: () => void;
      }): { open(): void };
    };
  }
}

const SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

export type PlaidStatus = "idle" | "opening" | "importing" | "syncing";

export function usePlaidConnect(onState: (state: StewardState) => void) {
  const [status, setStatus] = useState<PlaidStatus>("idle");
  const [error, setError] = useState("");

  const connect = useCallback(async () => {
    setError("");
    setStatus("opening");
    try {
      const tokenResponse = await fetch("/api/plaid/link-token", { method: "POST" });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenPayload.linkToken) {
        setError(tokenPayload.error ?? "Bank connections aren't available right now.");
        setStatus("idle");
        return;
      }

      if (!window.Plaid) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT}"]`);
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(), { once: true });
            return;
          }
          const script = document.createElement("script");
          script.src = SCRIPT;
          script.async = true;
          script.onload = () => resolve();
          script.onerror = () => reject();
          document.head.appendChild(script);
        });
      }

      window.Plaid?.create({
        token: tokenPayload.linkToken,
        onSuccess: async (publicToken, metadata) => {
          setStatus("importing");
          const exchange = await fetch("/api/plaid/exchange", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              publicToken,
              institutionId: metadata.institution?.institution_id,
              institutionName: metadata.institution?.name,
            }),
          });
          const payload = await exchange.json();
          if (!exchange.ok) {
            setError(payload.error ?? "The connection couldn't be saved.");
            setStatus("idle");
            return;
          }
          if (payload.state) onState(payload.state);

          setStatus("syncing");
          const sync = await fetch("/api/plaid/sync", { method: "POST" });
          const syncPayload = await sync.json();
          if (syncPayload.state) onState(syncPayload.state);
          if (!sync.ok) {
            setError(
              syncPayload.error ??
                "Your accounts connected, but transaction history is still arriving.",
            );
          }
          setStatus("idle");
        },
        onExit: () => setStatus("idle"),
      }).open();
    } catch {
      setError("Steward couldn't open the secure bank connection.");
      setStatus("idle");
    }
  }, [onState]);

  return { connect, status, error };
}
