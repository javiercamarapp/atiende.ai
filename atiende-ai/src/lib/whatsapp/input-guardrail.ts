// ═════════════════════════════════════════════════════════════════════════════
// INPUT GUARDRAIL — Block-mode (FIX 2 audit Round 2)
//
// Variante BLOCK para usar en processor.ts ANTES del LLM. Si detecta
// intento de prompt injection, retorna `true` y el caller responde con un
// mensaje amigable + persiste el bloqueo en logs.
//
// Coexiste con `src/lib/guardrails/input-guard.ts` (modo wrap/neutralize)
// que se usa en otros caminos. Aquí preferimos BLOCK porque el spec del
// negocio dice "el bot solo debe atender citas" — un mensaje de injection
// nunca es legítimo.
// ═════════════════════════════════════════════════════════════════════════════

import { MAX_USER_INPUT_CHARS_GUARDED } from '@/lib/config';

const INJECTION_PATTERNS: RegExp[] = [
  // Español
  /ignora?\s+(todas?\s+)?(tus|sus|las)\s+(instrucciones|reglas|restricciones)/i,
  /olvida?\s+(todo|tus\s+instrucciones)/i,
  /ahora\s+eres?\s+un?\s+/i,
  /system\s*prompt/i,
  /jailbreak/i,
  /\[INST\]|\[\/INST\]|<\|im_start\|>/i,
  // Inglés
  /ignore\s+previous\s+instructions/i,
  /you\s+are\s+now\s+/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /act\s+as\s+(if\s+you\s+are|a\s+)/i,
];

export function detectPromptInjection(content: string): boolean {
  if (!content) return false;
  return INJECTION_PATTERNS.some((p) => p.test(content));
}

export function sanitizeUserInput(content: string): string {
  if (!content) return '';
  // Remover HTML tags
  let clean = content.replace(/<[^>]*>/g, '');
  // Remover caracteres de control excepto newline / CR / tab
  // eslint-disable-next-line no-control-regex
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  // Truncar a MAX_USER_INPUT_CHARS_GUARDED máximo
  return clean.substring(0, MAX_USER_INPUT_CHARS_GUARDED);
}
