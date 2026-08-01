/**
 * PRESERVED PRE-REDESIGN APPLICATION.
 *
 * This route renders Steward exactly as it existed at tag `v0-baseline`, with
 * full workspace persistence. It exists so the redesign can replace `/` without
 * ever removing access to the working application.
 *
 * Do not modify this route or let the redesign's refactors reach it. When the
 * new experience reaches parity (Phase 10), this route is removed in a single
 * deliberate commit — not eroded gradually.
 */

import { createEmptyState } from "../../lib/initial-state";
import { getChatGPTUser } from "../chatgpt-auth";
import { StewardApp } from "../steward-app";

export const dynamic = "force-dynamic";

export default async function LegacySteward() {
  const user = await getChatGPTUser();
  const initialState = createEmptyState(
    user?.displayName ?? "Steward user",
    user?.email ?? "local@steward.app",
  );
  return <StewardApp initialState={initialState} />;
}
