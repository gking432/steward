import { collectSync } from "../../../../lib/bank-sync";
import { toModel, toLegacy } from "../../../../lib/model/convert";
import { readSnapshot } from "../../../../lib/server-workspace";
import { env } from "cloudflare:workers";
import {
  mergePlaidAccounts,
  mergePlaidFinancialData,
  type PlaidAccount,
  type PlaidRecurring,
  type PlaidTransaction,
} from "../../../../lib/financial-import";
import { decryptPlaidToken, plaidRequest } from "../../../../lib/plaid";
import {
  auditWorkspace,
  currentUser,
  loadWorkspace,
  prepareWorkspace,
} from "../../../../lib/server-workspace";

type SyncResponse = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
};

export async function POST() {
  try {
    const user = await currentUser();
    await prepareWorkspace();
    const items = await env.DB.prepare(
      `SELECT item_id, encrypted_access_token, cursor
       FROM plaid_items WHERE user_id = ? AND status = 'active'
       ORDER BY created_at ASC`,
    )
      .bind(user.email)
      .all<{
        item_id: string;
        encrypted_access_token: string;
        cursor: string | null;
      }>();
    if (!items.results?.length) {
      return Response.json({ error: "No connected institution." }, { status: 404 });
    }
    const original = await readSnapshot(user.email);
    if (!original) throw Error('Save your workspace before syncing.');
    const stored = JSON.parse(original.state_json);
    const canonical = toModel(await loadWorkspace(user.email, user.name));
    let state = toLegacy(canonical);
    delete state.canonical;
    const cursors: {id:string;cursor:string|undefined}[] = [];
    let imported = 0;
    for (const item of items.results) {
      const accessToken = await decryptPlaidToken(item.encrypted_access_token);
      const accountResult = await plaidRequest<{ accounts: PlaidAccount[] }>(
        "/accounts/get",
        { access_token: accessToken },
      );
      state = mergePlaidAccounts(state, accountResult.accounts, "");

      const {added,modified,removed,cursor} = await collectSync(item.cursor ?? undefined, cursor => plaidRequest<SyncResponse>("/transactions/sync", {access_token:accessToken,cursor,count:500,options:{include_original_description:true,personal_finance_category_version:"v2"}}));
      let recurring: PlaidRecurring | undefined;
      try {
        recurring = await plaidRequest<PlaidRecurring>(
          "/transactions/recurring/get",
          {
            access_token: accessToken,
            options: { personal_finance_category_version: "v2" },
          },
        );
      } catch {
        // Recurring Transactions is an optional Plaid add-on. Core sync continues.
      }
      state = mergePlaidFinancialData(state, {
        added,
        modified,
        removed,
        recurring,
      });
      imported += added.length + modified.length;
      cursors.push({id:item.item_id,cursor});
    }
    const importedModel=toModel(state);
    const workspace={...canonical,accounts:importedModel.accounts,transactions:importedModel.transactions,revision:(canonical.revision??0)+1};
    const revision=(stored.storageRevision??0)+1;
    const json=JSON.stringify({workspace,storageRevision:revision,syncId:crypto.randomUUID()});
    const now=new Date().toISOString();
    // D1 batch is atomic. Cursor writes are conditional on our successful CAS,
    // so a concurrent client edit or another sync cannot advance this cursor.
    const result=await env.DB.batch([
      env.DB.prepare("UPDATE steward_snapshots SET state_json = ?, updated_at = ? WHERE user_id = ? AND state_json = ?").bind(json,now,user.email,original.state_json),
      ...cursors.map(item=>env.DB.prepare("UPDATE plaid_items SET cursor = ?, last_synced_at = ?, updated_at = ? WHERE item_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM steward_snapshots WHERE user_id = ? AND state_json = ?)").bind(item.cursor,now,now,item.id,user.email,user.email,json))
    ]);
    if(result[0].meta?.changes !== 1) return Response.json({error:'Workspace changed during sync. Retry to merge the latest corrections.'},{status:409});
    state=toLegacy(workspace);
    await auditWorkspace(user.email, "bank_data_synced");
    return Response.json({ state, imported, revision });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The connection needs attention.";
    return Response.json(
      { error: `Transaction sync failed. ${message}` },
      { status: 502 },
    );
  }
}
