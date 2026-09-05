/**
 * PUBLIC DEMO.
 *
 * Uses the same canonical workspace as the visual test harness, but presents
 * it as a deliberate product experience. Server sync stays off so exploring
 * the demo can never overwrite a signed-in visitor's real workspace.
 */

import { demoWorkspace, FIXTURE_TODAY } from "../../fixtures/golden-workspace";
import { StewardApp } from "../steward/app";

export const dynamic = "force-dynamic";

export default async function DemoSteward({searchParams}:{searchParams:Promise<{statements?:string}>}) {
  const params=await searchParams;
  return (
    <StewardApp
      initialState={demoWorkspace()}
      syncWithServer={false}
      fixedToday={FIXTURE_TODAY}
      demoMode
      showStatementImport={params.statements === "1"}
    />
  );
}
