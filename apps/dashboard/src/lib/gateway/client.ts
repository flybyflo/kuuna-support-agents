import "server-only";

import type { GatewayRouter } from "@kuuna/gateway/trpc";
import { createTRPCClient, httpLink } from "@trpc/client";

const GATEWAY_OPS_URL_CANDIDATES = [
  process.env.GATEWAY_OPS_BASE_URL,
  "http://gateway:8090",
  "http://localhost:8090",
  "http://127.0.0.1:8090",
  "http://host.docker.internal:8090",
]
  .filter((value): value is string => Boolean(value))
  .filter((value, index, self) => self.indexOf(value) === index);

export function getGatewayOpsToken(): string | null {
  return (
    process.env.DASHBOARD_GATEWAY_OPS_TOKEN ??
    process.env.GATEWAY_OPS_TOKEN ??
    process.env.DASHBOARD_INTERNAL_OPS_TOKEN ??
    null
  );
}

export function createGatewayTrpcClient(baseUrl: string, token: string) {
  return createTRPCClient<GatewayRouter>({
    links: [
      httpLink({
        url: `${baseUrl.replace(/\/$/, "")}/trpc`,
        headers: { "X-Internal-Token": token },
      }),
    ],
  });
}

export async function withGatewayClient<T>(operation: (client: ReturnType<typeof createGatewayTrpcClient>, baseUrl: string) => Promise<T>): Promise<T | null> {
  const token = getGatewayOpsToken();
  if (!token) return null;

  for (const baseUrl of GATEWAY_OPS_URL_CANDIDATES) {
    try {
      return await operation(createGatewayTrpcClient(baseUrl, token), baseUrl);
    } catch {
      // try next gateway URL
    }
  }
  return null;
}
