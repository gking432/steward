/**
 * PUBLIC DEMO.
 *
 * Uses the same canonical workspace as the visual test harness, but presents
 * it as a deliberate product experience. Server sync stays off so exploring
 * the demo can never overwrite a signed-in visitor's real workspace.
 */

import { FIXTURE_TODAY, goldenWorkspace } from "../../fixtures/golden-workspace";
import { StewardApp } from "../steward/app";

export const dynamic = "force-dynamic";

export default function DemoSteward() {
  return (
    <StewardApp
      initialState={goldenWorkspace()}
      syncWithServer={false}
      fixedToday={FIXTURE_TODAY}
      demoMode
    />
  );
}
