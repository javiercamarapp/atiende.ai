// ═════════════════════════════════════════════════════════════════════════════
// Next.js Edge middleware entry point.
//
// AUDIT FIX: antes el archivo no existía → toda la lógica de auth + CSP +
// OWASP headers + HSTS en src/proxy.ts NUNCA se ejecutaba. Next.js solo
// invoca middleware si existe `src/middleware.ts` (o `middleware.ts` en
// raíz) exportando `middleware` (o `default`).
//
// La lógica vive en proxy.ts (testeable independientemente vía proxy.test.ts).
// Este archivo solo re-exporta como wrapper.
// ═════════════════════════════════════════════════════════════════════════════

import { proxy, config as proxyConfig } from './proxy';

export const middleware = proxy;
export const config = proxyConfig;
