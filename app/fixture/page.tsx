/**
 * GOLDEN FIXTURE HARNESS.
 *
 * Renders the canonical test user (`fixtures/golden-workspace.ts`) with server
 * sync disabled, so the screen is a pure function of committed data. This is
 * how every phase of the redesign captures comparable screenshots and how a
 * reviewer inspects engine changes without connecting a bank.
 *
 * It reads no user data and writes nothing.
 */

import { goldenWorkspace } from "../../fixtures/golden-workspace";
import { StewardApp } from "../steward-app";

export const dynamic = "force-dynamic";

export default function FixtureSteward() {
  return <StewardApp initialState={goldenWorkspace()} syncWithServer={false} />;
}
