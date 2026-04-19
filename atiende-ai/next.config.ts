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

// https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || 'atiendeai',
  project: process.env.SENTRY_PROJECT || 'atiende-ai',

  silent: !process.env.CI,

  widenClientFileUpload: true,

  tunnelRoute: '/monitoring',

  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    excludeReplayIframe: true,
    excludeReplayShadowDom: true,
  },
});
