import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { z } from "zod";
import { createDemoState } from "../../../lib/demo-data";

export const dynamic = "force-dynamic";

const stateSchema = z
  .object({
    version: z.number(),
    profile: z.object({
      name: z.string().min(1).max(120),
      email: z.string().max(254),
      currency: z.enum(["USD", "EUR", "GBP", "CAD"]),
      nextPayday: z.string(),
      payFrequency: z.enum(["Weekly", "Biweekly", "Monthly"]),
      takeHomePay: z.number().finite().nonnegative(),
      minimumBuffer: z.number().finite().nonnegative(),
      riskTolerance: z.enum(["Cautious", "Balanced", "Flexible"]),
      budgetingStyle: z.enum(["Paycheck plan", "Monthly", "Weekly"]),
      theme: z.enum(["light", "dark", "system"]),
      onboardingComplete: z.boolean(),
    }),
  })
  .passthrough();

const schemaSql = `
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

async function currentUser() {
  const requestHeaders = await headers();
  const email =
    requestHeaders.get("oai-authenticated-user-email") ??
    "demo@steward.local";
  const encodedName = requestHeaders.get("oai-authenticated-user-full-name");
  const encoding = requestHeaders.get(
    "oai-authenticated-user-full-name-encoding",
  );
  let name = email === "demo@steward.local" ? "Alex Morgan" : email.split("@")[0];
  if (encodedName && encoding === "percent-encoded-utf-8") {
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      // Fall back to the stable email-derived display name.
    }
  }
  return { email, name };
}

async function prepare() {
  if (!env.DB) throw new Error("Steward persistence is temporarily unavailable.");
  await env.DB.batch([
    env.DB.prepare(schemaSql),
    env.DB.prepare(auditSql),
  ]);
}

async function audit(userId: string, action: string) {
  await env.DB.prepare(
    "INSERT INTO audit_logs (id, user_id, action, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(crypto.randomUUID(), userId, action, new Date().toISOString())
    .run();
}

export async function GET() {
  try {
    await prepare();
    const user = await currentUser();
    const row = await env.DB.prepare(
      "SELECT state_json FROM steward_snapshots WHERE user_id = ?",
    )
      .bind(user.email)
      .first<{ state_json: string }>();

    if (row?.state_json) {
      return Response.json({
        state: JSON.parse(row.state_json),
        mode: user.email === "demo@steward.local" ? "demo" : "private",
      });
    }

    const state = createDemoState(user.name, user.email);
    await env.DB.prepare(
      "INSERT INTO steward_snapshots (user_id, state_json, updated_at) VALUES (?, ?, ?)",
    )
      .bind(user.email, JSON.stringify(state), new Date().toISOString())
      .run();
    await audit(user.email, "workspace_created");
    return Response.json({
      state,
      mode: user.email === "demo@steward.local" ? "demo" : "private",
    });
  } catch {
    const user = await currentUser();
    return Response.json({
      state: createDemoState(user.name, user.email),
      mode: "fallback",
      warning: "Changes will remain in this session until storage reconnects.",
    });
  }
}

export async function PUT(request: Request) {
  try {
    await prepare();
    const user = await currentUser();
    const body = await request.json();
    const result = stateSchema.safeParse(body);
    if (!result.success) {
      return Response.json(
        { error: "The financial workspace contains invalid values." },
        { status: 400 },
      );
    }
    const safeState = {
      ...body,
      profile: { ...body.profile, email: user.email },
    };
    await env.DB.prepare(
      `INSERT INTO steward_snapshots (user_id, state_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`,
    )
      .bind(user.email, JSON.stringify(safeState), new Date().toISOString())
      .run();
    await audit(user.email, "workspace_saved");
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Steward could not save your changes right now." },
      { status: 503 },
    );
  }
}

export async function DELETE() {
  try {
    await prepare();
    const user = await currentUser();
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM steward_snapshots WHERE user_id = ?",
      ).bind(user.email),
      env.DB.prepare("DELETE FROM audit_logs WHERE user_id = ?").bind(
        user.email,
      ),
    ]);
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Steward could not delete the workspace right now." },
      { status: 503 },
    );
  }
}
