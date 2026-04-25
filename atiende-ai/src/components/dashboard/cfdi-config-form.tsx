'use client';

import { useEffect, useState } from 'react';

type ConfigState = {
  has_api_key: boolean;
  api_key_preview: string | null;
  legal_business_name: string | null;
  legal_rfc: string | null;
  legal_tax_regime: string | null;
  legal_address: string | null;
  legal_postal_code: string | null;
  cfdi_default_use: string;
};

const TAX_REGIMES: Array<{ code: string; label: string }> = [
  { code: '601', label: '601 — General de Ley Personas Morales' },
  { code: '603', label: '603 — Personas Morales con Fines no Lucrativos' },
  { code: '605', label: '605 — Sueldos y Salarios e Ingresos Asimilados a Salarios' },
  { code: '606', label: '606 — Arrendamiento' },
  { code: '608', label: '608 — Demás ingresos' },
  { code: '610', label: '610 — Residentes en el Extranjero sin EP en México' },
  { code: '611', label: '611 — Ingresos por Dividendos (socios y accionistas)' },
  { code: '612', label: '612 — Personas Físicas con Actividades Empresariales y Profesionales' },
  { code: '614', label: '614 — Ingresos por intereses' },
  { code: '616', label: '616 — Sin obligaciones fiscales' },
  { code: '621', label: '621 — Incorporación Fiscal' },
  { code: '625', label: '625 — Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas' },
  { code: '626', label: '626 — Régimen Simplificado de Confianza (RESICO)' },
];

const CFDI_USES: Array<{ code: string; label: string }> = [
  { code: 'G03', label: 'G03 — Gastos en general' },
  { code: 'D01', label: 'D01 — Honorarios médicos, dentales y hospitalarios' },
  { code: 'G01', label: 'G01 — Adquisición de mercancías' },
  { code: 'G02', label: 'G02 — Devoluciones, descuentos o bonificaciones' },
  { code: 'P01', label: 'P01 — Por definir' },
  { code: 'S01', label: 'S01 — Sin efectos fiscales' },
  { code: 'CN01', label: 'CN01 — Nómina' },
];

export function CfdiConfigForm() {
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [legalBusinessName, setLegalBusinessName] = useState('');
  const [legalRfc, setLegalRfc] = useState('');
  const [legalTaxRegime, setLegalTaxRegime] = useState('');
  const [legalAddress, setLegalAddress] = useState('');
  const [legalPostalCode, setLegalPostalCode] = useState('');
  const [cfdiDefaultUse, setCfdiDefaultUse] = useState('G03');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/tenants/cfdi-config')
      .then((r) => r.json())
      .then((data: ConfigState) => {
        setConfig(data);
        setLegalBusinessName(data.legal_business_name || '');
        setLegalRfc(data.legal_rfc || '');
        setLegalTaxRegime(data.legal_tax_regime || '');
        setLegalAddress(data.legal_address || '');
        setLegalPostalCode(data.legal_postal_code || '');
        setCfdiDefaultUse(data.cfdi_default_use || 'G03');
      })
      .catch(() => setError('No pudimos cargar la configuración. Recargá la página.'));
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    const payload: Record<string, string | null> = {
      legal_business_name: legalBusinessName.trim() || null,
      legal_rfc: legalRfc.trim().toUpperCase() || null,
      legal_tax_regime: legalTaxRegime || null,
      legal_address: legalAddress.trim() || null,
      legal_postal_code: legalPostalCode.trim() || null,
      cfdi_default_use: cfdiDefaultUse,
    };
    if (apiKeyInput.trim()) payload.facturapi_api_key = apiKeyInput.trim();

    try {
      const res = await fetch('/api/tenants/cfdi-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || data.error || 'No pudimos guardar la configuración.');
        return;
      }
      setSavedAt(Date.now());
      setApiKeyInput(''); // limpiamos el input — la key ya quedó server-side
      // Refrescá el preview
      const r = await fetch('/api/tenants/cfdi-config');
      if (r.ok) setConfig(await r.json());
    } finally {
      setSaving(false);
    }
  };

  if (!config) {
    return <div className="bg-white rounded-2xl border border-zinc-100 p-6 text-sm text-zinc-500">Cargando…</div>;
  }

  return (
    <div className="space-y-5">
      <section className="bg-white rounded-2xl border border-zinc-100 p-5">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">API Key de Facturapi</h2>
        {config.has_api_key ? (
          <p className="text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2.5 mb-3">
            ✓ Configurada {config.api_key_preview ? `(${config.api_key_preview})` : ''}
          </p>
        ) : (
          <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5 mb-3">
            ⚠ Sin configurar — sin esto no podemos emitir CFDIs automáticamente.
          </p>
        )}
        <label className="block text-xs text-zinc-500 mb-1">
          Pegá tu API key (la dejás en blanco si querés conservar la actual)
        </label>
        <input
          type="password"
          value={apiKeyInput}
          onChange={(e) => setApiKeyInput(e.target.value)}
          placeholder="sk_user_..."
          autoComplete="new-password"
          className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm font-mono focus:outline-none focus:border-[hsl(var(--brand-blue))]"
        />
      </section>

      <section className="bg-white rounded-2xl border border-zinc-100 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-900">Datos fiscales del consultorio</h2>
        <p className="text-[12px] text-zinc-500 -mt-2">
          Lo que aparece como emisor en cada CFDI. Tienen que coincidir EXACTAMENTE con tu constancia de
          situación fiscal del SAT.
        </p>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">Razón social / Nombre completo</label>
          <input
            type="text"
            value={legalBusinessName}
            onChange={(e) => setLegalBusinessName(e.target.value)}
            placeholder="Dr. Juan Pérez García / Clínica Dental Roma SC"
            className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-[hsl(var(--brand-blue))]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">RFC</label>
            <input
              type="text"
              value={legalRfc}
              onChange={(e) => setLegalRfc(e.target.value.toUpperCase())}
              maxLength={13}
              placeholder="XAXX010101000"
              className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm font-mono focus:outline-none focus:border-[hsl(var(--brand-blue))]"
            />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Código Postal</label>
            <input
              type="text"
              value={legalPostalCode}
              onChange={(e) => setLegalPostalCode(e.target.value.replace(/\D/g, ''))}
              maxLength={5}
              placeholder="06700"
              className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm font-mono focus:outline-none focus:border-[hsl(var(--brand-blue))]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">Régimen fiscal</label>
          <select
            value={legalTaxRegime}
            onChange={(e) => setLegalTaxRegime(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-[hsl(var(--brand-blue))] bg-white"
          >
            <option value="">Selecciona…</option>
            {TAX_REGIMES.map((r) => (
              <option key={r.code} value={r.code}>{r.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">Dirección fiscal (opcional)</label>
          <input
            type="text"
            value={legalAddress}
            onChange={(e) => setLegalAddress(e.target.value)}
            placeholder="Av. Reforma 100, Col. Juárez, CDMX"
            className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-[hsl(var(--brand-blue))]"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-500 mb-1">Uso de CFDI por default</label>
          <select
            value={cfdiDefaultUse}
            onChange={(e) => setCfdiDefaultUse(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm focus:outline-none focus:border-[hsl(var(--brand-blue))] bg-white"
          >
            {CFDI_USES.map((u) => (
              <option key={u.code} value={u.code}>{u.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-zinc-400 mt-1">
            Para honorarios médicos lo más común es <strong>D01</strong>; el paciente puede cambiarlo al pedir factura.
          </p>
        </div>
      </section>

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-5 h-10 bg-[hsl(var(--brand-blue))] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 transition"
        >
          {saving ? 'Guardando…' : 'Guardar configuración'}
        </button>
        {savedAt && Date.now() - savedAt < 5_000 && (
          <span className="text-[12px] text-emerald-700">✓ Guardado</span>
        )}
      </div>
    </div>
  );
}
