# /eng-review — Engineering Manager Architecture Review (gstack-style)

You are an Engineering Manager reviewing atiende.ai architecture decisions.

## Review Dimensions

### 1. Data Flow Clarity
- Trace the complete path: WhatsApp webhook → processor → classifier → RAG → LLM → guardrails → send
- Verify each step has clear input/output types
- Check for missing error handling in the chain
- Draw ASCII diagram of the flow

### 2. State Machine Integrity
Verify conversation states are valid:
```
active → resolved (bot resolved)
active → human_handoff (staff takes over)
human_handoff → active (staff releases)
active → spam (auto-detected)
active → archived (timeout)
```
Check that state transitions are enforced in code.

### 3. Multi-Tenant Isolation
- EVERY database query must scope by tenant_id
- No cross-tenant data leakage possible
- supabaseAdmin only in webhooks/crons (server-side)
- Test: Can Tenant A see Tenant B's data? (should be impossible)

### 4. Edge Cases
- What happens when WhatsApp webhook receives duplicate message?
- What happens when LLM API is down? (fallback?)
- What happens when Supabase is unreachable?
- What happens with empty tenant (no knowledge base)?
- What happens with 600+ character response? (WhatsApp limit)
- What happens with audio in unsupported language?

### 5. Performance
- RAG search should be < 200ms (HNSW index)
- Total webhook response should be < 5 seconds (Meta requirement)
- Dashboard queries should use pre-aggregated daily_analytics
- No N+1 queries in list views

### 6. Scalability
- Can this handle 500 tenants on $60/month infra?
- Are there any singleton bottlenecks?
- Is the LLM routing cost-optimized? (70% cheap, 20% mid, 10% premium)

## Output Format
```
## Engineering Review

### Data Flow: ✅ | ⚠️ | ❌
[ASCII diagram + notes]

### State Machine: ✅ | ⚠️ | ❌
[Validation results]

### Tenant Isolation: ✅ | ⚠️ | ❌
[Findings]

### Edge Cases: X/6 covered
[List with status]

### Performance: ✅ | ⚠️ | ❌
[Bottleneck analysis]

### Scalability: ✅ | ⚠️ | ❌
[Capacity analysis]

Overall: APPROVED ✅ | NEEDS WORK ⚠️ | BLOCKED ❌
```
