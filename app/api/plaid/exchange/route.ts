import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { z } from "zod";
import { encryptPlaidToken, plaidRequest } from "../../../../lib/plaid";

const bodySchema = z.object({
  publicToken: z.string().min(1).max(2_000),
  institutionId: z.string().max(200).optional(),
});

const itemTableSql = `
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

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json({ error: "Invalid Plaid token." }, { status: 400 });
  }
  const requestHeaders = await headers();
  const email =
    requestHeaders.get("oai-authenticated-user-email") ??
    "demo@steward.local";
  try {
    const exchanged = await plaidRequest<{
      access_token: string;
      item_id: string;
    }>("/item/public_token/exchange", {
      public_token: parsed.data.publicToken,
    });
    const accountsResult = await plaidRequest<{
      accounts: {
        account_id: string;
        name: string;
        official_name?: string;
        type: string;
        subtype?: string;
        balances: {
          current: number | null;
          available: number | null;
          limit: number | null;
        };
      }[];
    }>("/accounts/get", { access_token: exchanged.access_token });

    await env.DB.prepare(itemTableSql).run();
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
        email,
        encrypted,
        parsed.data.institutionId ?? null,
        now,
        now,
        now,
      )
      .run();

    return Response.json({
      itemId: exchanged.item_id,
      accounts: accountsResult.accounts.map((account) => ({
        id: `plaid-${account.account_id}`,
        plaidAccountId: account.account_id,
        name: account.name,
        institution: account.official_name ?? "Connected institution",
        type:
          account.type === "depository"
            ? account.subtype === "savings"
              ? "Savings"
              : "Checking"
            : account.type === "credit"
              ? "Credit card"
              : account.type === "investment"
                ? "Investment"
                : account.type === "loan"
                  ? "Loan"
                  : "Other",
        balance: account.balances.current ?? 0,
        available: account.balances.available ?? 0,
        creditLimit: account.balances.limit ?? undefined,
        source: "plaid",
        status: "connected",
        lastSynced: "Just now",
      })),
    });
  } catch {
    return Response.json(
      { error: "Steward could not finish the bank connection." },
      { status: 502 },
    );
  }
}
