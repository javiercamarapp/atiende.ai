// This file configures the initialization of Sentry on the client (browser).
// Runs whenever a user loads a page.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn:
    process.env.NEXT_PUBLIC_SENTRY_DSN ||
    'https://30827be580c7d347af98c473f618d7e7@o4511223361896448.ingest.us.sentry.io/4511223364648960',

  // Session replay (record user sessions for debugging)
  integrations: [Sentry.replayIntegration()],

  // Sample rates
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% when error occurs

  enableLogs: true,

  // WhatsApp phone numbers = PII. Keep OFF; mask explicitly where needed.
  sendDefaultPii: false,

  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
