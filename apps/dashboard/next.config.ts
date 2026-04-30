import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  transpilePackages: ["@kuuna/api-client-ts"],
  async redirects() {
    return [
      { source: "/messages", destination: "/inbox", permanent: false },
      {
        source: "/messages/:groupId",
        destination: "/inbox/:groupId",
        permanent: false,
      },
      {
        source: "/bindings",
        destination: "/inbox?filter=bound",
        permanent: false,
      },
      {
        source: "/bindings/create",
        destination: "/inbox/create",
        permanent: false,
      },
      // Bindings detail redirects to /inbox; the binding-id -> provider-group-id
      // lookup is not trivial server-side, so users land on the inbox root and
      // can navigate to the desired group's settings tab from there.
      {
        source: "/bindings/:bindingId",
        destination: "/inbox",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
