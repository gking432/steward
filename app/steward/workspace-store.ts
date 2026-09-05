"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Workspace } from "../../lib/model/types";
import type { StewardState } from "../../lib/steward-types";
import { migrateWorkspace, SaveQueue } from "../../lib/model/persistence";

export type SaveState = "saved" | "saving" | "offline" | "conflict";
export function useWorkspace(initial: StewardState, sync = true) {
  const [workspace, setWorkspace] = useState(() => migrateWorkspace(initial));
  const [loading, setLoading] = useState(sync);
  const [saveState, setSaveState] = useState<SaveState>(sync ? "saving" : "saved");
  const revision = useRef(0);
  const queue = useRef<SaveQueue<Workspace> | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (!sync) {
      try { const saved = sessionStorage.getItem('steward-demo:' + location.pathname); if (saved) queueMicrotask(() => setWorkspace(migrateWorkspace(JSON.parse(saved)))); } catch { /* An unavailable demo cache never blocks exploration. */ }
      return;
    }
    let cancelled = false;
    queue.current = new SaveQueue(async value => {
      const response = await fetch('/api/steward', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: value, expectedRevision: revision.current }), signal: AbortSignal.timeout(12000) });
      if (response.status === 409) throw new Error('conflict');
      if (!response.ok) throw new Error('save failed');
      const payload = await response.json();
      revision.current = payload.revision;
    }, state => { if (!cancelled) setSaveState(state); });
    fetch('/api/steward', { signal: AbortSignal.timeout(12000) }).then(async response => {
      if (!response.ok) throw new Error('unavailable');
      const payload = await response.json();
      if (cancelled) return;
      if (payload.workspace || payload.state) setWorkspace(migrateWorkspace(payload.workspace ?? payload.state));
      revision.current = payload.revision ?? 0;
      setSaveState('saved');
    }).catch(() => { if (!cancelled) setSaveState('offline'); }).finally(() => { if (!cancelled) setLoading(false); });
    const retry = () => void queue.current?.flush();
    window.addEventListener('online', retry);
    return () => { cancelled = true; window.removeEventListener('online', retry); };
  }, [sync]);
  useEffect(() => {
    if (!dirty.current || loading) return;
    if (!sync) { try { sessionStorage.setItem('steward-demo:' + location.pathname, JSON.stringify(workspace)); } catch { queueMicrotask(() => setSaveState('offline')); } return; }
    queue.current?.enqueue(workspace);
  }, [workspace, sync, loading]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current && saveState !== 'saved') { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);
  const update = useCallback((next: (current: Workspace) => Workspace) => {
    dirty.current = true;
    setWorkspace(current => ({ ...next(current), revision: (current.revision ?? 0) + 1 }));
  }, []);
  const setWorkspaceFromServer = useCallback((next: StewardState, serverRevision?: number) => {
    revision.current = serverRevision ?? revision.current;
    dirty.current = false;
    setWorkspace(migrateWorkspace(next));
  }, []);
  return { workspace, update, loading, saveState, setWorkspaceFromServer, retrySave: () => queue.current?.flush() };
}
