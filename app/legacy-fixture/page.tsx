/** The pre-redesign UI rendered against the golden fixture, for comparison. */

import { goldenWorkspace } from "../../fixtures/golden-workspace";
import { StewardApp } from "../steward-app";

export const dynamic = "force-dynamic";

export default function LegacyFixture() {
  return <StewardApp initialState={goldenWorkspace()} syncWithServer={false} />;
}
