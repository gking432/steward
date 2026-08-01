/**
 * GOLDEN SCENARIO — the golden workspace converted to the domain model, with
 * the claim list ranked the way TARGET_V1 assumes.
 *
 * Ranking is a user input, so the engine cannot be tested against the
 * converter's arbitrary default order. This file fixes that input so engine
 * expectations are reproducible from committed data.
 *
 * Ranks (BLUEPRINT.md §C3 worked example):
 *   1 Card payoff   2 Cushion   3 Keyboard   4 Apartment   5 Golf net
 */

import { goldenWorkspace, FIXTURE_TODAY } from "./golden-workspace";
import { toModel } from "../lib/model/convert";
import type { Claim, Workspace } from "../lib/model/types";

export { FIXTURE_TODAY };

const RANKING = [
  "Travel Rewards Card",
  "Cushion",
  "Logitech keyboard",
  "Apartment",
  "Golf net",
];

export function goldenScenario(): Workspace {
  const base = toModel(goldenWorkspace());

  // The Apartment project is being funded as a pool rather than itemised, which
  // is the "single claim that becomes a project" case from BLUEPRINT.md §A.
  const apartment: Claim = {
    id: "claim:apartment-pool",
    name: "Apartment",
    kind: "purchase",
    projectId: "project:fx-proj-apartment",
    targetAmount: 900,
    fundedAmount: 275,
    rank: 3,
    status: "active",
    horizon: "arrival",
    divisible: false,
    delayCost: { type: "none" },
    protected: false,
  };

  const claims = [...base.claims, apartment].map((claim) => {
    const rank = RANKING.indexOf(claim.name);
    if (rank === -1) return { ...claim, status: "someday" as const };
    // The keyboard's fixture desiredDate would force a deadline pass; the
    // worked example treats it as an ordinary ranked purchase.
    const delayCost =
      claim.kind === "purchase" ? ({ type: "none" } as const) : claim.delayCost;
    return { ...claim, rank, status: "active" as const, delayCost };
  });

  return { ...base, claims };
}
