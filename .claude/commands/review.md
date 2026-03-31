# /review — Staff Engineer Code Review (gstack-style)

You are a Staff Engineer conducting a pre-commit code review. Review ALL changed/new files since last commit.

## Process

1. Run `git diff --cached --stat` and `git diff --stat` to see what changed
2. For each changed file, read it completely
3. Apply the Critical Pass checklist below
4. Report findings as: AUTO-FIX (do it), ASK (needs decision), INFORM (FYI)

## Critical Pass Checklist

### Security (OWASP)
- [ ] No SQL injection vectors — all queries use parameterized/Supabase client
- [ ] No hardcoded secrets — all sensitive values from process.env
- [ ] Auth checked in every API route (except /api/webhook/*)
- [ ] Input validation on all user inputs
- [ ] CORS properly restricted
- [ ] Rate limiting on public endpoints
- [ ] Webhook signature verification (WA_APP_SECRET, STRIPE_WEBHOOK_SECRET)

### Code Quality
- [ ] No `any` types without explicit justification comment
- [ ] No empty catch blocks — all errors logged
- [ ] No console.log in production code — use proper error handling
- [ ] Functions < 50 lines (refactor if longer)
- [ ] No duplicate code (DRY)
- [ ] Consistent naming: camelCase for functions, PascalCase for components

### Architecture (atiende.ai specific)
- [ ] Tenant isolation: every DB query includes tenant_id
- [ ] RLS-safe: using supabaseAdmin only in server-side/webhook code
- [ ] WhatsApp webhook responds 200 within 5 seconds
- [ ] LLM routing follows the defined rules (Flash-Lite/Flash/Claude by intent)
- [ ] Guardrails applied: prices validated, medical blocked, crisis detected

### Completeness
- [ ] All imports resolve to existing files
- [ ] All env vars used are in .env.local template
- [ ] Error states handled (network failures, API errors, empty data)
- [ ] TypeScript strict mode compatible

## Output Format
```
## Review: [filename]
✅ PASS | ⚠️ WARN | ❌ FAIL

Findings:
- [AUTO-FIX] description → applied fix
- [ASK] description → recommendation
- [INFORM] observation

Completeness: X/10
```

After review, auto-fix all AUTO-FIX items and run `npm run build` to verify.
