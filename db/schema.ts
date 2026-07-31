import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
};

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("USD"),
  payFrequency: text("pay_frequency").notNull().default("Biweekly"),
  nextPayday: text("next_payday"),
  takeHomePay: real("take_home_pay").notNull().default(0),
  minimumBuffer: real("minimum_buffer").notNull().default(0),
  riskTolerance: text("risk_tolerance").notNull().default("Balanced"),
  preferencesJson: text("preferences_json").notNull().default("{}"),
  ...timestamps,
});

export const financialAccounts = sqliteTable(
  "financial_accounts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    institution: text("institution"),
    type: text("type").notNull(),
    balance: real("balance").notNull().default(0),
    available: real("available").notNull().default(0),
    creditLimit: real("credit_limit"),
    interestRate: real("interest_rate"),
    minimumPayment: real("minimum_payment"),
    dueDate: text("due_date"),
    source: text("source").notNull().default("manual"),
    status: text("status").notNull().default("manual"),
    archived: integer("archived", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (table) => [uniqueIndex("account_user_id_idx").on(table.userId, table.id)],
);

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    accountId: text("account_id").notNull(),
    merchant: text("merchant").notNull(),
    description: text("description"),
    amount: real("amount").notNull(),
    date: text("date").notNull(),
    category: text("category").notNull().default("Uncategorized"),
    subcategory: text("subcategory"),
    type: text("type").notNull().default("expense"),
    pending: integer("pending", { mode: "boolean" }).notNull().default(false),
    recurring: integer("recurring", { mode: "boolean" }).notNull().default(false),
    excluded: integer("excluded", { mode: "boolean" }).notNull().default(false),
    confidence: real("confidence"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("transaction_user_id_idx").on(table.userId, table.id),
  ],
);

export const bills = sqliteTable("bills", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  amount: real("amount").notNull(),
  dueDate: text("due_date").notNull(),
  frequency: text("frequency").notNull(),
  autopay: integer("autopay", { mode: "boolean" }).notNull().default(false),
  essential: integer("essential", { mode: "boolean" }).notNull().default(true),
  accountId: text("account_id"),
  ...timestamps,
});

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  target: real("target").notNull(),
  current: real("current").notNull().default(0),
  targetDate: text("target_date"),
  priority: text("priority").notNull().default("Medium"),
  status: text("status").notNull().default("Active"),
  ...timestamps,
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  category: text("category"),
  priority: text("priority").notNull().default("Medium"),
  status: text("status").notNull().default("Planned"),
  estimatedCost: real("estimated_cost").notNull().default(0),
  actualCost: real("actual_cost").notNull().default(0),
  progress: real("progress").notNull().default(0),
  nextAction: text("next_action"),
  metadataJson: text("metadata_json").notNull().default("{}"),
  ...timestamps,
});

export const wishlistItems = sqliteTable("wishlist_items", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  projectId: text("project_id"),
  name: text("name").notNull(),
  category: text("category"),
  priority: text("priority").notNull().default("Medium"),
  price: real("price").notNull(),
  desiredDate: text("desired_date"),
  safeDate: text("safe_date"),
  status: text("status").notNull().default("Considering"),
  recommendationReason: text("recommendation_reason"),
  ...timestamps,
});

export const recommendations = sqliteTable("recommendations", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  priority: text("priority").notNull(),
  impact: real("impact").notNull().default(0),
  confidence: real("confidence").notNull().default(0),
  reason: text("reason"),
  action: text("action"),
  status: text("status").notNull().default("active"),
  ...timestamps,
});

export const userMemories = sqliteTable("user_memories", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  label: text("label").notNull(),
  value: text("value").notNull(),
  category: text("category").notNull(),
  ...timestamps,
});

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  period: text("period").notNull(),
  type: text("type").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  ...timestamps,
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  ...timestamps,
});

export const plaidItems = sqliteTable("plaid_items", {
  itemId: text("item_id").primaryKey(),
  userId: text("user_id").notNull(),
  encryptedAccessToken: text("encrypted_access_token").notNull(),
  institutionId: text("institution_id"),
  cursor: text("cursor"),
  status: text("status").notNull().default("active"),
  lastSyncedAt: text("last_synced_at"),
  ...timestamps,
});

// Steward's first deployment persists the cohesive client workspace here while
// the normalized tables above remain the migration target for granular sync.
export const stewardSnapshots = sqliteTable("steward_snapshots", {
  userId: text("user_id").primaryKey(),
  stateJson: text("state_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  action: text("action").notNull(),
  createdAt: text("created_at").notNull(),
});
