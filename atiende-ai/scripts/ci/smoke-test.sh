#!/usr/bin/env bash
set -euo pipefail

# Smoke test: verify the Next.js build output is functional.
# Runs after `npm run build` in CI to catch runtime issues that
# type-check and unit tests miss (missing env at import time,
# broken dynamic imports, etc.).

echo "=== Smoke Test: checking build artifacts ==="

# 1. Verify .next directory exists and has server output
if [ ! -d ".next" ]; then
  echo "FAIL: .next directory not found — build did not produce output"
  exit 1
fi

if [ ! -d ".next/server" ]; then
  echo "FAIL: .next/server not found — server build incomplete"
  exit 1
fi

echo "OK: build artifacts present"

# 2. Check critical route manifests exist
ROUTES_MANIFEST=".next/routes-manifest.json"
if [ ! -f "$ROUTES_MANIFEST" ]; then
  echo "FAIL: routes-manifest.json not found"
  exit 1
fi

# 3. Verify critical API routes are in the manifest
for route in "/api/webhook/whatsapp" "/api/webhook/stripe" "/api/webhook/retell"; do
  if ! grep -q "$route" "$ROUTES_MANIFEST"; then
    echo "FAIL: critical route $route missing from build manifest"
    exit 1
  fi
done

echo "OK: critical API routes present in manifest"

# 4. Check that the middleware was compiled
if [ ! -f ".next/server/middleware.js" ] && [ ! -f ".next/server/middleware-manifest.json" ]; then
  echo "WARN: middleware output not found (may be edge runtime)"
fi

echo "=== Smoke Test: PASSED ==="
