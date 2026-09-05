import { toLegacy, toModel } from "../../../../lib/model/convert";
import { readSnapshot, saveCanonical } from "../../../../lib/server-workspace";
import { env } from "cloudflare:workers";
import { z } from "zod";
import {
  mergePlaidAccounts,
  type PlaidAccount,
} from "../../../../lib/financial-import";
import { encryptPlaidToken, plaidRequest } from "../../../../lib/plaid";
import {
  auditWorkspace,
  currentUser,
  loadWorkspace,
  plaidItemsSql,
  prepareWorkspace,
} from "../../../../lib/server-workspace";

const bodySchema = z.object({
  publicToken: z.string().min(1).max(2_000),
  institutionId: z.string().max(200).optional(),
  institutionName: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid Plaid token." }, { status: 400 });
  }
  try {
    const user = await currentUser();
    const exchanged = await plaidRequest<{
      access_token: string;
      item_id: string;
    }>("/item/public_token/exchange", {
      public_token: parsed.data.publicToken,
    });
    const accountsResult = await plaidRequest<{
      accounts: PlaidAccount[];
    }>("/accounts/get", { access_token: exchanged.access_token });

    await prepareWorkspace();
    await env.DB.prepare(plaidItemsSql).run();
    const encrypted = await encryptPlaidToken(exchanged.access_token);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO plaid_items (
        item_id, user_id, encrypted_access_token, institution_id, cursor,
        status, last_synced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'active', ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        encrypted_access_token = excluded.encrypted_access_token,
        institution_id = excluded.institution_id,
        status = 'active',
        updated_at = excluded.updated_at`,
    )
      .bind(
        exchanged.item_id,
        user.email,
        encrypted,
        parsed.data.institutionId ?? null,
        now,
        now,
        now,
      )
      .run();

    const row=await readSnapshot(user.email);
    const stored=row ? JSON.parse(row.state_json) : null;
    const workspace=toModel(await loadWorkspace(user.email,user.name));
    const imported = mergePlaidAccounts(
      toLegacy(workspace),
      accountsResult.accounts,
      parsed.data.institutionName ?? "Connected institution",
    );
    const next={...workspace,accounts:imported.accounts,revision:(workspace.revision??0)+1};
    const revision=await saveCanonical(user.email,next,stored?.storageRevision??0);
    if(revision===null) return Response.json({error:'Workspace changed while connecting. Retry sync to import accounts.'},{status:409});
    const state=toLegacy(next);
    await auditWorkspace(user.email, "bank_connected");

    return Response.json({
      itemId: exchanged.item_id,
      state, revision,
    });
  } catch {
    return Response.json(
      { error: "Steward could not finish the bank connection." },
      { status: 502 },
    );
  }
}
