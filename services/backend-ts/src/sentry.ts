import * as Sentry from "@sentry/node";

import { getSettings } from "./config.js";
import { scrubValue } from "./logging.js";

let initialized = false;

export function initSentry(): void {
  if (initialized) {
    return;
  }

  const settings = getSettings();
  if (!settings.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    dsn: settings.SENTRY_DSN,
    environment: settings.APP_ENV,
    sendDefaultPii: false,
    beforeSend(event) {
      return scrubValue("event", event) as typeof event;
    },
  });
  initialized = true;
}
