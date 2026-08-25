/**
 * Compatibility surface for a Vercel-hosted portfolio demo.
 *
 * The production demo needs server-side secrets but not the Cloudflare-only
 * D1/Plaid paths. Those bindings intentionally remain absent on Vercel.
 */
export const env = process.env;
