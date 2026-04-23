// This file configures the initialization of Sentry on the client (browser).
// Runs whenever a user loads a page.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

// See sentry.server.config.ts — hardcoded DSN fallback removed for public
// repo; missing NEXT_PUBLIC_SENTRY_DSN disables Sentry rather than leaking
// the real DSN (which would let anyone spam our ingest quota).
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || '',

  // Session replay (record user sessions for debugging)
  integrations: [Sentry.replayIntegration()],

  // Sample rates
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  replaysSessionSampleRate: 0.1, // 10% of sessions
  replaysOnErrorSampleRate: 1.0, // 100% when error occurs

  // WhatsApp phone numbers = PII. Keep OFF; mask explicitly where needed.
  sendDefaultPii: false,

  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || 'development',
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
