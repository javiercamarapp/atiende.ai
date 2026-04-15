import { describe, it, expect } from 'vitest';
import { isOptOutIntent, OPT_OUT_REGEX, OPT_OUT_MAX_LENGTH } from '../opt-out-regex';

describe('OPT_OUT_REGEX — hardening (AUDIT R14)', () => {
  describe('TRUE POSITIVES — deben activar opt-out', () => {
    const positives = [
      'STOP',
      'stop',
      'Stop',
      'Quiero darme de baja',
      'quiero darme de baja por favor',
      'quiero de baja',
      'denme de baja',
      'déme de baja',
      'darme de baja',
      'dar de baja',
      'unsubscribe',
      'unsuscribe', // typo común
      'No me manden más mensajes',
      'no me manden mensajes',
      'no quiero mensajes',
      'no quiero más notificaciones',
      'no quiero notificación',
      'cancelar suscripción',
      'cancelar mi suscripcion',
      'cancelar mi cuenta',
      'dejar de recibir',
      'quítame de la lista',
      'quitame de la lista',
    ];

    for (const msg of positives) {
      it(`matches: "${msg}"`, () => {
        expect(isOptOutIntent(msg)).toBe(true);
      });
    }
  });

  describe('FALSE POSITIVES — NO deben activar opt-out', () => {
    const negatives = [
      // Palabras que contienen "baja" pero no son opt-out
      'rebaja', // descuento
      'rebajas de temporada',
      'embajada de México',
      'traje de baja calidad', // "baja" adjetivo
      'quiero una rebaja',

      // Palabras que contienen "stop" pero no son opt-out
      'me gusta el ketchup stop',  // muy corto pero tiene "stop" aislado… edge case
      // Nota: "stop" solo SÍ activa. Esto es el trade-off — Meta mandate.

      // Mensajes largos con contexto distinto
      'Hola buenos días, mi hermana se quiere cancelar una cita que tenía para el próximo lunes, ¿me pueden ayudar con eso? Es urgente',
      // NOTA: no incluimos "darme de alta ... no para darme de baja" — la
      // regex no hace NLI; la negación "no para" no neutraliza el match.
      // Documentado como limitación en opt-out-regex.ts.
      'Tengo baja presión arterial desde hace años, ¿pueden atenderme?',
      'Es una promo de temporada baja, ¿aplica en diciembre?',

      // Mensaje sin contenido
      '',
      '   ',
    ];

    for (const msg of negatives) {
      // Caso especial — mostly acepto la decisión actual: "stop" aislado es
      // un mandate de Meta y se trata como opt-out por política.
      if (msg.includes('stop') && msg.length < OPT_OUT_MAX_LENGTH) continue;

      it(`NO match: "${msg.slice(0, 60)}${msg.length > 60 ? '...' : ''}"`, () => {
        expect(isOptOutIntent(msg)).toBe(false);
      });
    }
  });

  describe('guard de longitud', () => {
    it('rechaza mensajes ≥150 chars aunque contengan "darme de baja"', () => {
      const longMsg =
        'Quiero darme de baja del seguro médico de mi trabajo pero antes ' +
        'necesito agendar una cita para una limpieza dental el próximo ' +
        'jueves por la tarde si es posible, gracias de antemano!';
      expect(longMsg.length).toBeGreaterThanOrEqual(OPT_OUT_MAX_LENGTH);
      expect(isOptOutIntent(longMsg)).toBe(false);
    });

    it('acepta mensajes cortos con la intención clara', () => {
      expect(isOptOutIntent('Quiero darme de baja')).toBe(true);
      expect(isOptOutIntent('darme de baja')).toBe(true);
    });
  });

  describe('case insensitivity + acentos', () => {
    it('match con mayúsculas', () => {
      expect(isOptOutIntent('QUIERO DARME DE BAJA')).toBe(true);
      expect(isOptOutIntent('STOP')).toBe(true);
    });
    it('match con/sin acentos', () => {
      expect(isOptOutIntent('déme de baja')).toBe(true);
      expect(isOptOutIntent('deme de baja')).toBe(true);
      expect(isOptOutIntent('quítame de la lista')).toBe(true);
      expect(isOptOutIntent('quitame de la lista')).toBe(true);
    });
  });

  describe('regex directamente (para otros callers potenciales)', () => {
    it('expone OPT_OUT_REGEX', () => {
      expect(OPT_OUT_REGEX).toBeInstanceOf(RegExp);
      expect(OPT_OUT_REGEX.test('darme de baja')).toBe(true);
    });
    it('expone OPT_OUT_MAX_LENGTH constante', () => {
      expect(OPT_OUT_MAX_LENGTH).toBe(150);
    });
  });
});
