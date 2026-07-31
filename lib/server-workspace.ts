import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import type { StewardState } from "./steward-types";
import { createEmptyState } from "./initial-state";

const snapshotSql = `
  CREATE TABLE IF NOT EXISTS steward_snapshots (
    user_id TEXT PRIMARY KEY NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

const auditSql = `
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`;

export const plaidItemsSql = `
  CREATE TABLE IF NOT EXISTS plaid_items (
    item_id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    encrypted_access_token TEXT NOT NULL,
    institution_id TEXT,
    cursor TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

export async function currentUser() {
  const requestHeaders = await headers();
  const email =
    requestHeaders.get("oai-authenticated-user-email") ??
    "local@steward.app";
  const encodedName = requestHeaders.get("oai-authenticated-user-full-name");
  const encoding = requestHeaders.get(
    "oai-authenticated-user-full-name-encoding",
  );
  let name = email === "local@steward.app" ? "Steward user" : email.split("@")[0];
  if (encodedName && encoding === "percent-encoded-utf-8") {
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      // Keep the stable email-derived name when a header is malformed.
    }
  }
  return { email, name };
}

export async function prepareWorkspace() {
  if (!env.DB) throw new Error("Steward persistence is unavailable.");
  await env.DB.batch([
    env.DB.prepare(snapshotSql),
    env.DB.prepare(auditSql),
    env.DB.prepare(plaidItemsSql),
  ]);
}

export async function loadWorkspace(
  email: string,
  name = "Steward user",
): Promise<StewardState> {
  const row = await env.DB.prepare(
    "SELECT state_json FROM steward_snapshots WHERE user_id = ?",
  )
    .bind(email)
    .first<{ state_json: string }>();
  return row?.state_json
    ? (JSON.parse(row.state_json) as StewardState)
    : createEmptyState(name, email);
}

export async function saveWorkspace(email: string, state: StewardState) {
  await env.DB.prepare(
    `INSERT INTO steward_snapshots (user_id, state_json, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`,
  )
    .bind(email, JSON.stringify(state), new Date().toISOString())
    .run();
}

export async function auditWorkspace(email: string, action: string) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, user_id, action, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), email, action, new Date().toISOString())
    .run();
}
