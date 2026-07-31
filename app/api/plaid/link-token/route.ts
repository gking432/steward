import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import {
  plaidConfigured,
  plaidRequest,
  stablePlaidUserId,
} from "../../../../lib/plaid";

export async function POST() {
  if (!plaidConfigured()) {
    return Response.json(
      {
        error:
          "Bank connections are not enabled yet. Manual accounts and demo data remain available.",
      },
      { status: 503 },
    );
  }
  const requestHeaders = await headers();
  const email =
    requestHeaders.get("oai-authenticated-user-email") ??
    "demo@steward.local";
  const runtime = env as unknown as Record<string, string | undefined>;
  try {
    const result = await plaidRequest<{
      link_token: string;
      expiration: string;
    }>("/link/token/create", {
      user: { client_user_id: await stablePlaidUserId(email) },
      client_name: "Steward",
      products: ["transactions"],
      transactions: { days_requested: 180 },
      country_codes: ["US"],
      language: "en",
      webhook: runtime.PLAID_WEBHOOK_URL,
    });
    return Response.json({
      linkToken: result.link_token,
      expiration: result.expiration,
    });
  } catch {
    return Response.json(
      { error: "Steward could not start a secure bank connection." },
      { status: 502 },
    );
  }
}
