"use client";

/**
 * Workspace store — loads the stored legacy state, adapts it to the domain
 * model for reading, and writes it back through the converter.
 *
 * Stored data is never rewritten into a new shape (Phase 1 decision), so the
 * redesign stays reversible and `/legacy` keeps working against the same rows.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toLegacy, toModel } from "../../lib/model/convert";
import type { Workspace } from "../../lib/model/types";
import type { StewardState } from "../../lib/steward-types";

export type SaveState = "saved" | "saving" | "offline";

export function useWorkspace(initial: StewardState, sync = true) {
  const [legacy, setLegacy] = useState(initial);
  const [loading, setLoading] = useState(sync);
  const [saveState, setSaveState] = useState<SaveState>(sync ? "saving" : "saved");
  const loaded = useRef(!sync);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!sync) return;
    fetch("/api/steward")
      .then((response) => response.json())
      .then((payload) => {
        if (payload.state) setLegacy(payload.state);
        setSaveState(payload.mode === "fallback" ? "offline" : "saved");
      })
      .catch(() => setSaveState("offline"))
      .finally(() => {
        loaded.current = true;
        setLoading(false);
      });
  }, [sync]);

  useEffect(() => {
    if (!loaded.current || !sync) return;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch("/api/steward", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(legacy),
      })
        .then((response) => {
          if (!response.ok) throw new Error("save failed");
          setSaveState("saved");
        })
        .catch(() => setSaveState("offline"));
    }, 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [legacy, sync]);

  const workspace = useMemo(() => toModel(legacy), [legacy]);

  /** Mutate the domain model; the converter writes it back to stored shape. */
  const update = useCallback((next: (current: Workspace) => Workspace) => {
    setLegacy((current) => toLegacy(next(toModel(current))));
  }, []);

  return { workspace, update, loading, saveState };
}
