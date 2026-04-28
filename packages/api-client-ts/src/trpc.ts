import { createTRPCClient, httpLink, httpSubscriptionLink, loggerLink, splitLink } from "@trpc/client";

import type { AppRouter } from "@kuuna/backend-ts";

export type KuunaTrpcClient = ReturnType<typeof createKuunaTrpcClient>;
export type KuunaEventSourceInit = EventSourceInit & {
  headers?: Record<string, string>;
};
export type KuunaEventSource = new (url: string | URL, eventSourceInitDict?: KuunaEventSourceInit) => EventSource;

export type KuunaTrpcClientOptions = {
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
  enableLogger?: boolean;
  eventSource?: KuunaEventSource;
};

export function createKuunaTrpcClient(options: KuunaTrpcClientOptions) {
  const normalizedBaseUrl = options.baseUrl.replace(/\/$/, "");
  const headers = () => ({
    ...options.headers,
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  });
  const EventSourceConstructor = (options.eventSource ?? globalThis.EventSource) as KuunaEventSource;

  return createTRPCClient<AppRouter>({
    links: [
      ...(options.enableLogger ? [loggerLink<AppRouter>()] : []),
      splitLink({
        condition: (operation) => operation.type === "subscription",
        true: httpSubscriptionLink<AppRouter, KuunaEventSource>({
          url: `${normalizedBaseUrl}/trpc`,
          EventSource: EventSourceConstructor,
          eventSourceOptions: () => ({ headers: headers() }),
        }),
        false: httpLink({
          url: `${normalizedBaseUrl}/trpc`,
          headers,
        }),
      }),
    ],
  });
}
