import { env } from "cloudflare:workers";
import { z } from "zod";
import { createEmptyState } from "../../../lib/initial-state";
import {
  auditWorkspace,
  currentUser,
  loadWorkspace,
  prepareWorkspace,
  saveWorkspace,
} from "../../../lib/server-workspace";
import { decryptPlaidToken, plaidRequest } from "../../../lib/plaid";

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

export async function GET() {
  try {
    await prepareWorkspace();
    const user = await currentUser();
    const state = await loadWorkspace(user.email, user.name);
    await saveWorkspace(user.email, state);
    await auditWorkspace(user.email, "workspace_loaded");
    return Response.json({
      state,
      mode: "private",
    });
  } catch {
    const user = await currentUser();
    return Response.json({
      state: createEmptyState(user.name, user.email),
      mode: "fallback",
      warning: "Changes will remain in this session until storage reconnects.",
    });
  }
}

export async function PUT(request: Request) {
  try {
    await prepareWorkspace();
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
    await saveWorkspace(user.email, safeState);
    await auditWorkspace(user.email, "workspace_saved");
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
    await prepareWorkspace();
    const user = await currentUser();
    const items = await env.DB.prepare(
      "SELECT item_id, encrypted_access_token FROM plaid_items WHERE user_id = ?",
    )
      .bind(user.email)
      .all<{ item_id: string; encrypted_access_token: string }>();
    await Promise.allSettled(
      (items.results ?? []).map(async (item) => {
        const accessToken = await decryptPlaidToken(item.encrypted_access_token);
        await plaidRequest("/item/remove", { access_token: accessToken });
      }),
    );
    await env.DB.batch([
      env.DB.prepare(
        "DELETE FROM steward_snapshots WHERE user_id = ?",
      ).bind(user.email),
      env.DB.prepare("DELETE FROM audit_logs WHERE user_id = ?").bind(
        user.email,
      ),
      env.DB.prepare("DELETE FROM plaid_items WHERE user_id = ?").bind(
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
