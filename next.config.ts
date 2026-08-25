import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Sites runs on Cloudflare Workers, where `cloudflare:workers` is a native
  // module. Vercel does not provide that module, so its Next.js build swaps in
  // a tiny process.env-backed compatibility module. The public demo only uses
  // the AI route; D1/Plaid remain disabled there.
  webpack(config, { webpack }) {
    if (process.env.VERCEL) {
      const compatibilityModule = path.resolve(
        process.cwd(),
        "lib/vercel-cloudflare-workers.ts",
      );
      config.resolve.alias["cloudflare:workers"] = compatibilityModule;
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^cloudflare:workers$/,
          compatibilityModule,
        ),
      );
    }
    return config;
  },
};

export default nextConfig;
