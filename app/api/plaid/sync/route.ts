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
  saveWorkspace,
} from "../../../../lib/server-workspace";

type SyncResponse = {
  added: PlaidTransaction[];
  modified: PlaidTransaction[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
};

export async function POST() {
  const user = await currentUser();
  try {
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
    let state = await loadWorkspace(user.email, user.name);
    let imported = 0;
    for (const item of items.results) {
      const accessToken = await decryptPlaidToken(item.encrypted_access_token);
      const accountResult = await plaidRequest<{ accounts: PlaidAccount[] }>(
        "/accounts/get",
        { access_token: accessToken },
      );
      state = mergePlaidAccounts(state, accountResult.accounts, "");

      let cursor = item.cursor ?? undefined;
      const added: PlaidTransaction[] = [];
      const modified: PlaidTransaction[] = [];
      const removed: { transaction_id: string }[] = [];
      let hasMore = true;
      while (hasMore) {
        const result = await plaidRequest<SyncResponse>("/transactions/sync", {
          access_token: accessToken,
          cursor,
          count: 500,
          options: {
            include_original_description: true,
            personal_finance_category_version: "v2",
          },
        });
        added.push(...result.added);
        modified.push(...result.modified);
        removed.push(...result.removed);
        cursor = result.next_cursor;
        hasMore = result.has_more;
      }
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
      const now = new Date().toISOString();
      await env.DB.prepare(
        "UPDATE plaid_items SET cursor = ?, last_synced_at = ?, updated_at = ? WHERE item_id = ? AND user_id = ?",
      )
        .bind(cursor, now, now, item.item_id, user.email)
        .run();
    }
    await saveWorkspace(user.email, state);
    await auditWorkspace(user.email, "bank_data_synced");
    return Response.json({ state, imported });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The connection needs attention.";
    return Response.json(
      { error: `Transaction sync failed. ${message}` },
      { status: 502 },
    );
  }
}
