// This file configures the initialization of Sentry for edge features (middleware, edge routes).
// The config you add here will be used whenever one of the edge features is loaded.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

// See sentry.server.config.ts — hardcoded DSN fallback removed for public
// repo; missing SENTRY_DSN disables Sentry rather than leaking the real DSN.
Sentry.init({
  dsn: process.env.SENTRY_DSN || '',

  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.2 : 1.0,

  sendDefaultPii: false,

  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
});
