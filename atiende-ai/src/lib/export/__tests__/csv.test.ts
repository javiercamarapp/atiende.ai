import { describe, it, expect } from 'vitest';
import { conversationsToCSV, messagesToCSV } from '../csv';

describe('conversationsToCSV()', () => {
  it('genera CSV con headers correctos', () => {
    const csv = conversationsToCSV([]);
    expect(csv).toContain('Nombre');
    expect(csv).toContain('Teléfono');
    expect(csv).toContain('Estado');
  });

  it('incluye datos de conversaciones', () => {
    const csv = conversationsToCSV([{
      customer_name: 'Juan Pérez',
      customer_phone: '+5219991234567',
      status: 'active',
      created_at: '2026-01-01',
      last_message_at: '2026-01-02',
      tags: ['VIP', 'dental'],
    }]);
    expect(csv).toContain('Juan Pérez');
    expect(csv).toContain('+5219991234567');
    expect(csv).toContain('active');
    expect(csv).toContain('VIP, dental');
  });

  it('maneja tags vacíos', () => {
    const csv = conversationsToCSV([{
      customer_name: 'Test',
      customer_phone: '123',
      status: 'resolved',
      created_at: '2026-01-01',
      last_message_at: '2026-01-01',
      tags: [],
    }]);
    expect(csv).toContain('Test');
  });
});

describe('messagesToCSV()', () => {
  it('genera CSV con headers correctos', () => {
    const csv = messagesToCSV([]);
    expect(csv).toContain('Dirección');
    expect(csv).toContain('Contenido');
    expect(csv).toContain('Intent');
  });

  it('escapa comillas en contenido', () => {
    const csv = messagesToCSV([{
      direction: 'inbound',
      sender_type: 'customer',
      content: 'Dice "hola" amigos',
      intent: 'GREETING',
      model_used: '',
      created_at: '2026-01-01',
    }]);
    expect(csv).toContain('""hola""');
  });
});
