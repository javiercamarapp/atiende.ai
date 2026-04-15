// This file configures the initialization of Sentry for edge features (middleware, edge routes).
// The config you add here will be used whenever one of the edge features is loaded.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ||
    'https://30827be580c7d347af98c473f618d7e7@o4511223361896448.ingest.us.sentry.io/4511223364648960',

  tracesSampleRate: process.env.VERCEL_ENV === 'production' ? 0.2 : 1.0,

  enableLogs: true,

  sendDefaultPii: false,

  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development',
});
