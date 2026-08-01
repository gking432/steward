/**
 * GOLDEN EXPECTATIONS — the measured behaviour of the pre-redesign engine, and
 * the target behaviour of the redesigned engine, for `goldenWorkspace()`.
 *
 * BASELINE_V0 was produced by running the v0-baseline engine against the golden
 * fixture on 2026-08-01. It is a record of fact, not an endorsement: several of
 * these numbers are the defects the redesign exists to fix. Do not "fix" this
 * block — it is the before picture.
 *
 * TARGET_V1 is the contract Phase 2 must satisfy. Every number is derived by
 * hand in BLUEPRINT.md §C and must be reproducible from the fixture alone.
 *
 * If an engine change moves a TARGET_V1 number, that is a product decision and
 * needs review. It is never a test to update silently.
 */

/** What the pre-redesign engine actually produced. Historical record. */
export const BASELINE_V0 = {
  safeToSpend: 1041,
  liquidCash: 1840,
  /** Rent ($1,600, due 08-28) is excluded — it falls after the next payday. */
  billsBeforePayday: 221,
  /** Only the card minimum. The $289 auto-loan minimum is not counted. */
  requiredDebt: 78,
  savingsCommitment: 100,

  /** Plan → "Next paycheck" tab. */
  allocationAssigned: 856,
  allocationRemaining: 1294,

  /** Plan → "All buckets" tab, for the same workspace at the same instant. */
  bucketsTotalAssigned: 1660,
  bucketsRemaining: 490,

  /**
   * The two Plan views disagree by $804 about how much money is unspoken for,
   * and neither reserves any part of the $1,600 rent due in 27 days.
   */
  planDisagreement: 804,

  /** Rent has no bucket at all this cycle: it falls outside 07-27 → 08-10. */
  rentReservedThisCycle: 0,

  debt: { total: 11099, minimums: 367, extraPerMonth: 541.67, months: 14, interest: 539.52 },
} as const;

/** What the redesigned engine must produce. See BLUEPRINT.md §C. */
export const TARGET_V1 = {
  cycle: { start: "2026-07-27", end: "2026-08-10", income: 2150 },

  /**
   * Reserves, pro-rated across the paydays remaining before each due date.
   * Rent is the case that proves it: $1,600 due 08-28, two paychecks away.
   */
  reserves: {
    rent: 800,      // (1600 − 0) / 2 paychecks
    electric: 96,   // due 08-05, this cycle
    internet: 70,   // due 08-07, this cycle
    phone: 55,      // due 08-09, this cycle
    cardMinimum: 78,
    loanMinimum: 289,
    total: 1388,
  },

  /** Everyday spend buckets, unchanged from the fixture's per-paycheck amounts. */
  spend: { groceries: 150, dining: 75, transportation: 60, household: 37, total: 322 },

  bufferTopUp: 0,   // checking already clears the $400 floor
  commitments: 0,

  /** 2150 − 1388 − 322 − 0 − 0 */
  freeCapacity: 440,

  /**
   * Ranked allocation of free capacity under the default policy: interest-aware
   * suggestion for the card, then strict waterfall, then the spread limit.
   */
  allocation: [
    { rank: 1, claim: "Card payoff", amount: 250, outcome: "paid off 2027-01-07" },
    { rank: 2, claim: "Cushion", amount: 100, outcome: "$2,000 by 2027-04" },
    { rank: 3, claim: "Logitech keyboard", amount: 90, outcome: "complete this cycle" },
    { rank: 4, claim: "Apartment", amount: 0, outcome: "starts 2026-08-24" },
    { rank: 5, claim: "Golf net", amount: 0, outcome: "starts 2026-09-07" },
  ],

  /** Invariants that must hold for ANY workspace, not just this fixture. */
  invariants: [
    "reserves + spend + bufferTopUp + commitments + freeCapacity === income + carryIn",
    "sum(allocation amounts) <= freeCapacity",
    "no obligation is ever reduced to balance a cycle",
    "every displayed total equals the sum of its drilldown rows",
    "reordering claims never changes any claim's fundedAmount",
    "an unconfirmed payday proposal never mutates claim funding",
  ],
} as const;
