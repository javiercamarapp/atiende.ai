# k6 Load Tests

## Install k6

- **Mac**: `brew install grafana/k6/k6`
- **Linux**: `sudo apt install k6`

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `BASE_URL` | Target server URL | `http://localhost:3000` |
| `WA_APP_SECRET` | WhatsApp app secret for webhook signature | `test-secret` |
| `AUTH_TOKEN` | Bearer token for authenticated endpoints | (empty) |

## Run

```bash
# WhatsApp webhook load test (hottest endpoint)
k6 run scripts/load/webhook-whatsapp.js

# Auth/login rate-limit test
k6 run scripts/load/api-auth.js

# Dashboard API load test
k6 run scripts/load/api-dashboard.js
```

With environment variables:

```bash
BASE_URL=https://staging.atiende.ai WA_APP_SECRET=my-secret k6 run scripts/load/webhook-whatsapp.js
```

## Thresholds

- **webhook-whatsapp**: p95 < 500ms, error rate < 1%
- **api-auth**: p95 < 1000ms, error rate < 5%
- **api-dashboard**: p95 < 2000ms, error rate < 5%
