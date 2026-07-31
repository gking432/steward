import { env } from "cloudflare:workers";
import {
  plaidConfigured,
  plaidRequest,
  stablePlaidUserId,
} from "../../../../lib/plaid";
import { currentUser } from "../../../../lib/server-workspace";

export async function POST() {
  if (!plaidConfigured()) {
    return Response.json(
      {
        error:
          "Bank connections need Plaid credentials before you can continue.",
      },
      { status: 503 },
    );
  }
  const { email } = await currentUser();
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
      ...(runtime.PLAID_WEBHOOK_URL
        ? { webhook: runtime.PLAID_WEBHOOK_URL }
        : {}),
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
