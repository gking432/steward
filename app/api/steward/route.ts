import { boundedJson } from "../../../lib/request-limits";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { createEmptyState } from "../../../lib/initial-state";
import {
  currentUser,
  prepareWorkspace,
} from "../../../lib/server-workspace";
import { decryptPlaidToken, plaidRequest } from "../../../lib/plaid";

import { readSnapshot, saveCanonical } from '../../../lib/server-workspace';
import { migrateWorkspace } from '../../../lib/model/persistence';
import { workspaceSchema } from '../../../lib/model/validation';

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await currentUser();
    await prepareWorkspace();
    const row = await readSnapshot(user.email);
    const saved = row ? JSON.parse(row.state_json) : createEmptyState(user.name, user.email);
    return Response.json({ workspace: migrateWorkspace(saved.workspace ?? saved), revision: saved.storageRevision ?? 0, mode: "private" });
  } catch {
    return Response.json({ error: "Private storage or verified identity is unavailable. Explore the isolated demo or export your session." }, { status: 503 });
  }
}
export async function PUT(request: Request) {
  try {
    const user = await currentUser();
    if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) return Response.json({error:'Invalid origin'}, {status:403});
    const raw = await boundedJson(request,5_000_000);
    const result = z.object({ workspace: workspaceSchema, expectedRevision: z.number().int().nonnegative() }).safeParse(raw);
    if (!result.success) return Response.json({error: "The workspace contains invalid financial values.", issues: result.error.issues.map(i=>i.message)}, {status:400});
    await prepareWorkspace();
    const workspace = result.data.workspace as import('../../../lib/model/types').Workspace;
    workspace.profile.email = user.email;
    const revision = await saveCanonical(user.email, workspace, result.data.expectedRevision);
    if (revision === null) return Response.json({error:'Another save changed this workspace. Export your draft and reload before retrying.'}, {status:409});
    return Response.json({ok:true,revision});
  } catch { return Response.json({error:'Save unavailable. Export your draft and retry.'}, {status:503}); }
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
    const revocations = await Promise.allSettled(
      (items.results ?? []).map(async (item) => {
        const accessToken = await decryptPlaidToken(item.encrypted_access_token);
        await plaidRequest("/item/remove", { access_token: accessToken });
      }),
    );
    if (revocations.some(result=>result.status === 'rejected')) return Response.json({error:'Some bank connections could not be revoked. No local records were deleted; retry.'},{status:503});
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
