import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent } from "./sentry.shared";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  sendDefaultPii: false,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    return scrubSentryEvent(event);
  },
});
