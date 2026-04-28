declare module "event-source-polyfill" {
  type EventSourcePolyfillInit = EventSourceInit & {
    headers?: Record<string, string>;
  };

  export const EventSourcePolyfill: new (
    url: string | URL,
    eventSourceInitDict?: EventSourcePolyfillInit,
  ) => EventSource;
}
