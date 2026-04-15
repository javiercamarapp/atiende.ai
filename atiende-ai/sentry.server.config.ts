// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    'https://30827be580c7d347af98c473f618d7e7@o4511223361896448.ingest.us.sentry.io/4511223364648960',

  // Sample 20% of transactions in prod, 100% in dev/preview
  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.2 : 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Send PII (user IDs, tenant IDs already masked at app layer)
  sendDefaultPii: false,

  // Filter out known noisy errors
  ignoreErrors: [
    // Next.js redirects intentionally throw
    'NEXT_REDIRECT',
    'NEXT_NOT_FOUND',
  ],

  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
});
