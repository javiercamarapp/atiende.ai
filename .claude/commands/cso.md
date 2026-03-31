# /cso — Chief Security Officer Audit (gstack-style)

You are the CSO conducting a security audit on the atiende.ai codebase. This is a medical/financial SaaS handling sensitive data.

## Audit Scope

Scan ALL files in /home/user/atiende.ai/atiende-ai/src/ for security issues.

## OWASP Top 10 Checks

### A01: Broken Access Control
- Verify RLS policies exist for ALL 19 tables
- Verify tenant_id isolation in every query
- Check that supabaseAdmin (service role) is NEVER used in client-side code
- Verify middleware protects all /dashboard routes
- Check that /api/webhook/* routes are excluded from auth but verify signatures

### A02: Cryptographic Failures
- Verify wa_token is never exposed to client
- Check no PII (CURP, RFC, credit cards) stored in plaintext
- Verify all API keys come from process.env, never hardcoded

### A03: Injection
- Check for string concatenation in SQL (should use Supabase client)
- Check for unsanitized user input in WhatsApp messages
- Check for prompt injection protection in LLM calls
- Verify template literals don't include raw user input in system prompts

### A04: Insecure Design
- Verify rate limiting exists (Upstash Redis)
- Check conversation status machine (active → human_handoff → resolved)
- Verify medical guardrails block dangerous responses

### A05: Security Misconfiguration
- Verify .env.local is in .gitignore
- Check next.config.ts doesn't expose server-only env vars
- Verify CORS settings
- Check vercel.json cron routes are protected

### A06: Vulnerable Components
- Run `npm audit` and report findings
- Check for outdated critical deps

### A07: Authentication Failures
- Verify Supabase Auth JWT validation in middleware
- Check session refresh handling
- Verify logout clears all cookies

### A08: Software Integrity
- Verify WhatsApp webhook validates X-Hub-Signature-256 with WA_APP_SECRET
- Verify Stripe webhook validates stripe-signature
- Check Conekta webhook signature verification

### A09: Logging & Monitoring
- Verify audit_log table usage for sensitive operations
- Check error logging (not swallowed)
- Verify failed auth attempts are logged

### A10: SSRF
- Check that external URLs (WhatsApp media, Google Places) are validated
- Verify no user-controlled URLs passed to fetch without validation

## STRIDE Threat Model (atiende.ai specific)

- **Spoofing:** Tenant A impersonating Tenant B via manipulated tenant_id
- **Tampering:** Modifying WhatsApp webhook payloads
- **Repudiation:** No audit trail for message deletions
- **Information Disclosure:** Leaking patient data between tenants
- **DoS:** Spam messages overwhelming LLM pipeline
- **Elevation:** User accessing admin/service role operations

## Output Format
```
## Security Audit Report
Date: [date]
Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO

### Finding #N
- Category: [OWASP-AXX or STRIDE]
- Severity: [level]
- File: [path:line]
- Description: [what's wrong]
- Exploit Scenario: [how an attacker would use this]
- Remediation: [exact fix]
- Confidence: X/10
```

Only report findings with confidence >= 8/10. Apply fixes for all CRITICAL and HIGH findings.
