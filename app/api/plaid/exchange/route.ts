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
  saveWorkspace,
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
  const user = await currentUser();
  try {
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

    const workspace = await loadWorkspace(user.email, user.name);
    const state = mergePlaidAccounts(
      workspace,
      accountsResult.accounts,
      parsed.data.institutionName ?? "Connected institution",
    );
    await saveWorkspace(user.email, state);
    await auditWorkspace(user.email, "bank_connected");

    return Response.json({
      itemId: exchanged.item_id,
      state,
    });
  } catch {
    return Response.json(
      { error: "Steward could not finish the bank connection." },
      { status: 502 },
    );
  }
}
