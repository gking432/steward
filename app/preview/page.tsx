/**
 * Screenshot harness for the two gated screens.
 *
 * Per the agreed recovery plan, Connect and All-Buckets are reviewed before any
 * further screens are rebuilt. This route renders them against the golden
 * fixture so they can be looked at without a bank connection.
 *
 * Removed once the rebuild is approved and wired into the real flow.
 */

import { FIXTURE_TODAY } from "../../fixtures/golden-workspace";
import { PreviewClient } from "./preview-client";

export const dynamic = "force-dynamic";

export default function Preview() {
  return <PreviewClient today={FIXTURE_TODAY} />;
}
