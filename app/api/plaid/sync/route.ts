import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { decryptPlaidToken, plaidRequest } from "../../../../lib/plaid";

type SyncResponse = {
  added: unknown[];
  modified: unknown[];
  removed: { transaction_id: string }[];
  next_cursor: string;
  has_more: boolean;
};

export async function POST() {
  const requestHeaders = await headers();
  const email =
    requestHeaders.get("oai-authenticated-user-email") ??
    "demo@steward.local";
  try {
    const item = await env.DB.prepare(
      `SELECT item_id, encrypted_access_token, cursor
       FROM plaid_items WHERE user_id = ? AND status = 'active'
       ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(email)
      .first<{
        item_id: string;
        encrypted_access_token: string;
        cursor: string | null;
      }>();
    if (!item) {
      return Response.json({ error: "No connected institution." }, { status: 404 });
    }
    const accessToken = await decryptPlaidToken(item.encrypted_access_token);
    let cursor = item.cursor ?? undefined;
    const added: unknown[] = [];
    const modified: unknown[] = [];
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
    await env.DB.prepare(
      "UPDATE plaid_items SET cursor = ?, last_synced_at = ?, updated_at = ? WHERE item_id = ? AND user_id = ?",
    )
      .bind(
        cursor,
        new Date().toISOString(),
        new Date().toISOString(),
        item.item_id,
        email,
      )
      .run();
    return Response.json({ added, modified, removed, cursor });
  } catch {
    return Response.json(
      { error: "Transaction sync failed. The connection may need attention." },
      { status: 502 },
    );
  }
}
