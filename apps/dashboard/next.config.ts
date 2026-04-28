import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  webpack: (config, { webpack }) => {
    // Sentry bundles Prisma instrumentation as an optional integration; this dashboard
    // uses `pg` directly and does not rely on Prisma. Ignoring it prevents noisy
    // "Critical dependency" warnings during Next.js compilation.
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@prisma\/instrumentation$/,
      }),
    );

    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {
        module: /@prisma\/instrumentation/,
      },
    ];
    return config;
  },
};

export default nextConfig;
