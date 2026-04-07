// Vitest global setup — stub env vars required by modules at import time.
// Tests that need real values can override with vi.stubEnv inside the test.

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-openrouter-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key';
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.WA_SYSTEM_TOKEN = process.env.WA_SYSTEM_TOKEN || 'test-wa-token';
process.env.WA_VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN || 'test-verify-token';
process.env.WA_APP_SECRET = process.env.WA_APP_SECRET || 'test-app-secret';
process.env.RETELL_API_KEY = process.env.RETELL_API_KEY || 'test-retell-key';
process.env.RETELL_WEBHOOK_SECRET =
  process.env.RETELL_WEBHOOK_SECRET || 'test-retell-secret';
process.env.STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || 'test-stripe-secret';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'test-cron-secret';
