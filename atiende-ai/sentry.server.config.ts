// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

// AUDIT: previously had a hardcoded DSN fallback. Since the repo is public,
// that turned the project DSN into a free spam target — anyone could flood
// our ingest quota with garbage events. Removed: if SENTRY_DSN is missing,
// Sentry is simply disabled (empty string = no-op init).
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',

  // Sample 20% of transactions in prod, 100% in dev/preview
  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.2 : 1.0,

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
