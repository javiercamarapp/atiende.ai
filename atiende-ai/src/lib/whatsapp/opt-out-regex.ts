// ═════════════════════════════════════════════════════════════════════════════
// OPT-OUT REGEX — fast path para LFPDPPP + WhatsApp policy
//
// Extraído de processor.ts para tests unitarios focalizados.
// Esta regex detecta intención de opt-out (dar de baja de mensajes
// automáticos). Cubre: inglés (stop, unsubscribe), español formal
// ("cancelar suscripción"), español coloquial ("baja", "no me manden más
// mensajes"), y variaciones con/sin acentos.
//
// Hardening anti-falso-positivo:
//   - `\b` para matching de palabras completas (evita matchear "baja" dentro
//     de "rebaja" o "embajada").
//   - Guard de longitud (<150 chars) en el caller — mensajes largos que solo
//     mencionan "baja" de pasada no activan opt-out.
//
// Casos edge conocidos como FALSO POSITIVO (no pueden evitarse solo con regex):
//   - "Quiero darme de baja del seguro" — contexto legítimo de otra cosa.
//     La regex SÍ dispara, pero el guard de longitud o el AGENTE de FAQ
//     debería poder manejarlo. Test 'context-aware' abajo documenta el edge.
// ═════════════════════════════════════════════════════════════════════════════

// Antes la regex incluía `baja` como palabra suelta,
// causando falsos positivos en "traje de baja calidad", "baja presión
// arterial", "temporada baja", etc. También fallaba "no quiero más
// notificaciones" porque la alternancia `(quiero|m[áa]s)` no permitía
// ambos juntos. Fix:
//  - `baja` ahora SOLO en frase "dar(me)? de baja", "de baja".
//  - Reglas "no quiero" y "no me manden" aceptan "más" opcional entre medias.
export const OPT_OUT_REGEX = new RegExp(
  [
    '\\b(',
    // Inglés / WhatsApp mandate
    'stop|unsubscribe|unsuscribe',
    // "darme de baja", "dar de baja", "déme de baja", "denme de baja", "de baja"
    '|(d[eé]nme|d[eé]me|dar(me)?)\\s+de\\s+baja',
    '|quiero\\s+(darme\\s+)?de\\s+baja',
    // "no quiero (más) (mensajes|notificaciones)"
    '|no\\s+quiero\\s+(m[áa]s\\s+)?(mensajes?|notificaci[oó]n(es)?|alertas?)',
    // "no me manden (más) (mensajes)"
    '|no\\s+me\\s+manden(\\s+m[áa]s)?(\\s+mensajes?)?',
    '|cancelar\\s+(mi\\s+)?(suscripci[oó]n|cuenta)',
    '|dejar\\s+de\\s+recibir',
    '|qu[ií]t[ae]me\\s+de\\s+(la\\s+)?lista',
    ')\\b',
  ].join(''),
  'i',
);

/**
 * Máximo de caracteres de un mensaje considerado "intención de opt-out".
 * Mensajes más largos típicamente mezclan baja con otra intención (ej.
 * "Quiero darme de baja del seguro pero antes agendame una cita"), y no
 * deben activar el fast-path.
 */
export const OPT_OUT_MAX_LENGTH = 150;

/**
 * Devuelve true si el mensaje debe activar opt-out automático.
 */
export function isOptOutIntent(message: string): boolean {
  if (!message || message.length >= OPT_OUT_MAX_LENGTH) return false;
  return OPT_OUT_REGEX.test(message);
}
