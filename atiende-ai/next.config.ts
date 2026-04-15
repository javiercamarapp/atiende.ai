import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
    ],
  },
};

// https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/#extend-your-nextjs-configuration
export default withSentryConfig(nextConfig, {
  // Org + project slugs (visible in Sentry URL)
  org: 'atiendeai',
  project: 'javascript-nextjs',

  // Only print upload logs in CI
  silent: !process.env.CI,

  // Upload a larger set of source maps for prettier stack traces
  widenClientFileUpload: true,

  // Route Sentry requests through /monitoring to bypass ad-blockers
  tunnelRoute: '/monitoring',

  // Strip Sentry logger statements from prod bundles
  disableLogger: true,

  // Auto-instrument Vercel cron routes for monitoring
  automaticVercelMonitors: true,
});
