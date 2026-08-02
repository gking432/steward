/**
 * ALLOCATION POLICY — swappable configuration, not engine logic.
 *
 * BLUEPRINT.md §C3.2 / amendment A2. The allocator contains no APR literals and
 * no hard-coded percentages. Everything opinionated lives here so the policy can
 * evolve — or be replaced per user — without touching the engine.
 *
 * The behavior that must hold regardless of policy version:
 *   - Steward recognizes the cost of high-interest debt.
 *   - Steward recommends meaningful acceleration.
 *   - Steward shows the opportunity cost of choosing something else.
 *   - The user retains final control.
 *
 * Steward is not a debt-maximisation machine. A suggestion is a starting
 * position, stated once with its reason, and never re-argued.
 */

export type DebtSuggestion = {
  /** Cap on what this payoff claim takes from free capacity this cycle. */
  amount: number;
  /** Shown to the user once, verbatim. Never repeated as a nag. */
  rationale: string;
};

export type AllocationPolicy = {
  id: string;

  /**
   * Ceiling on a payoff claim's share of free capacity. A cap, not a floor:
   * ranking still decides who is served first.
   */
  suggestForDebt(input: {
    apr: number | undefined;
    balance: number;
    freeCapacity: number;
  }): DebtSuggestion;

  /**
   * Soft ceiling on how many claims receive money in one cycle. Exceeded freely
   * when deadlines, pins, or explicit intent require it — a preference, not a
   * law (amendment A3).
   */
  concentrationTarget: number;

  /** Beyond this horizon Steward refuses to print a date. §C11. */
  maxProjectionMonths: number;

  /** Flag an indivisible claim that will take longer than this. Once. §C5. */
  slowPurchaseCycles: number;
};

const bandFor = (apr: number) => (apr >= 15 ? 0.4 : apr >= 8 ? 0.25 : 0);

/**
 * Initial default. Deliberately simple and legible: a first heuristic to be
 * replaced once there is evidence about what users actually accept.
 */
export const aprBandsV1: AllocationPolicy = {
  id: "apr-bands-v1",

  suggestForDebt({ apr, balance, freeCapacity }) {
    if (apr === undefined) {
      return {
        amount: 0,
        rationale:
          "No interest rate on file, so Steward will not guess at how fast to pay this down.",
      };
    }
    const share = bandFor(apr);
    if (share === 0) {
      return {
        amount: 0,
        rationale: `At ${apr.toFixed(2)}% this is cheap debt — Steward does not push extra at it.`,
      };
    }
    const amount = Math.min(balance, Math.round(freeCapacity * share));
    return {
      amount,
      rationale: `${apr.toFixed(2)}% APR — Steward suggests about ${Math.round(share * 100)}% of what's free.`,
    };
  },

  concentrationTarget: 4,
  maxProjectionMonths: 12,
  slowPurchaseCycles: 6,
};

export const defaultPolicy = aprBandsV1;
