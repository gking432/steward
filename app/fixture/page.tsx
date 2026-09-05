/**
 * GOLDEN FIXTURE HARNESS.
 *
 * Renders the canonical test user with server sync disabled and a fixed
 * `today`, so the screen is a pure function of committed data. This is how each
 * phase captures comparable screenshots and how a reviewer inspects engine
 * changes without connecting a bank.
 */

import { FIXTURE_TODAY, goldenWorkspace } from "../../fixtures/golden-workspace";
import { StewardApp } from "../steward/app";

export const dynamic = "force-dynamic";

export default function FixtureSteward() {
  return (
    <StewardApp
      initialState={goldenWorkspace()}
      syncWithServer={false}
      fixedToday={FIXTURE_TODAY}
      demoMode
    />
  );
}
