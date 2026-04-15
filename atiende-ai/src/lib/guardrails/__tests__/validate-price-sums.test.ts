import { describe, it, expect } from 'vitest';
import { validateResponse } from '../validate';

const baseTenant = { business_type: 'dental', name: 'Consultorio Test' };

describe('validateResponse — price sums (AUDIT R12 BUG-005)', () => {
  it('acepta suma de 2 precios del RAG', () => {
    const rag = 'Limpieza $500 MXN. Extracción simple $300 MXN.';
    const response = 'Limpieza + extracción = $800 MXN.';
    const r = validateResponse(response, baseTenant, rag);
    // 800 = 500 + 300 → válido
    expect(r.valid).toBe(true);
  });

  it('acepta suma de 3 precios del RAG', () => {
    const rag = 'Limpieza $500. Extracción $300. Flúor $200.';
    const response = 'El paquete de los 3 le cuesta $1000 MXN.';
    const r = validateResponse(response, baseTenant, rag);
    expect(r.valid).toBe(true);
  });

  it('acepta precio literal del RAG', () => {
    const rag = 'Limpieza $500 MXN.';
    const response = 'La limpieza es $500 MXN.';
    const r = validateResponse(response, baseTenant, rag);
    expect(r.valid).toBe(true);
  });

  it('RECHAZA precio inventado que no es suma válida', () => {
    const rag = 'Limpieza $500. Extracción $300.';
    const response = 'Esa consulta cuesta $900 MXN.'; // 900 ≠ 500+300 ni combinaciones
    const r = validateResponse(response, baseTenant, rag);
    expect(r.valid).toBe(false);
    expect(r.text).toMatch(/precios exactos/i);
  });

  it('RECHAZA precio simple inventado', () => {
    const rag = 'Limpieza $500.';
    const response = 'Extracción cuesta $1200 MXN.'; // 1200 no está en RAG
    const r = validateResponse(response, baseTenant, rag);
    expect(r.valid).toBe(false);
  });

  it('no confunde "30 minutos" con precio', () => {
    const rag = 'Limpieza $500.';
    const response = 'La cita dura 30 minutos.';
    const r = validateResponse(response, baseTenant, rag);
    // 30 no tiene $ y es <100 → no se considera precio
    expect(r.valid).toBe(true);
  });

  it('acepta formato con comas', () => {
    const rag = 'Ortodoncia $12,000 MXN.';
    const response = 'El tratamiento completo es $12,000.';
    const r = validateResponse(response, baseTenant, rag);
    expect(r.valid).toBe(true);
  });
});
