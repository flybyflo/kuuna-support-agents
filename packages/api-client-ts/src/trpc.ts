import { createTRPCClient, httpLink, loggerLink } from "@trpc/client";

import type { AppRouter } from "@kuuna/backend-ts";

export type KuunaTrpcClient = ReturnType<typeof createKuunaTrpcClient>;

export type KuunaTrpcClientOptions = {
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
  enableLogger?: boolean;
};

export function createKuunaTrpcClient(options: KuunaTrpcClientOptions) {
  const normalizedBaseUrl = options.baseUrl.replace(/\/$/, "");

  return createTRPCClient<AppRouter>({
    links: [
      ...(options.enableLogger ? [loggerLink<AppRouter>()] : []),
      httpLink({
        url: `${normalizedBaseUrl}/trpc`,
        headers() {
          return {
            ...options.headers,
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          };
        },
      }),
    ],
  });
}
