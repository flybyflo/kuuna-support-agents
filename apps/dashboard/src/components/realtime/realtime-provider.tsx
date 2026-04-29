"use client";

import { useEffect } from "react";
import { EventSourcePolyfill } from "event-source-polyfill";
import { createKuunaTrpcClient, type KuunaEventSource } from "@kuuna/api-client-ts";

type RealtimeProviderProps = {
  baseUrl: string;
  token: string;
  children: React.ReactNode;
};

export function RealtimeProvider({ baseUrl, token, children }: RealtimeProviderProps) {
  useEffect(() => {
    const client = createKuunaTrpcClient({
      baseUrl,
      token,
      eventSource: EventSourcePolyfill as unknown as KuunaEventSource,
    });
    const subscription = client.runtimeEvents.onEvent.subscribe(undefined, {
      onData(event) {
        window.dispatchEvent(new CustomEvent("kuuna:runtime-event", { detail: event }));
      },
      onError(error) {
        console.warn("[kuuna-realtime] subscription failed", error);
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [baseUrl, token]);

  return children;
}
