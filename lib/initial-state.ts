import type { StewardState } from "./steward-types";

export function createEmptyState(
  name = "Steward user",
  email = "local@steward.app",
): StewardState {
  return {
    version: 2,
    profile: {
      name,
      email,
      currency: "USD",
      nextPayday: "",
      payFrequency: "Biweekly",
      takeHomePay: 0,
      minimumBuffer: 0,
      riskTolerance: "Balanced",
      budgetingStyle: "Paycheck plan",
      theme: "light",
      onboardingComplete: false,
    },
    accounts: [],
    transactions: [],
    bills: [],
    goals: [],
    projects: [],
    wishlist: [],
    recommendations: [],
    paycheckPlan: {
      date: "",
      expected: 0,
      actual: 0,
      savings: 0,
      debt: 0,
      groceries: 0,
      transportation: 0,
      dining: 0,
      buffer: 0,
      projects: 0,
    },
    budgets: [],
    memories: [],
    reviews: [],
    notifications: [],
    notificationPreferences: {
      bills: true,
      sync: true,
      recommendations: true,
      weeklyReview: true,
    },
  };
}
