'use client';

import { useEffect, useState } from 'react';
import { Video } from 'lucide-react';

type Provider = 'jitsi' | 'daily' | 'custom_url';

type ConfigState = {
  telemedicine_enabled: boolean;
  telemedicine_provider: Provider;
  telemedicine_custom_url: string | null;
};

const PROVIDER_INFO: Record<Provider, { label: string; description: string }> = {
  jitsi: {
    label: 'Jitsi Meet',
    description: 'Gratis, sin API key. El sistema crea salas tipo `meet.jit.si/atiende--xxxx`. Recomendado para arrancar.',
  },
  daily: {
    label: 'Daily.co',
    description: 'Mejor calidad de video, recording, control de host. Requiere cuenta y API key (próximamente).',
  },
  custom_url: {
    label: 'URL personalizada',
    description: 'Si ya tenés Zoom, Google Meet, Whereby o sala propia. Pegamos siempre la misma URL — útil para consultorios con sala fija.',
  },
};

export function TelemedConfigForm() {
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<Provider>('jitsi');
  const [customUrl, setCustomUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/tenants/telemed-config')
      .then((r) => r.json())
      .then((data: ConfigState) => {
        setConfig(data);
        setEnabled(data.telemedicine_enabled);
        setProvider(data.telemedicine_provider);
        setCustomUrl(data.telemedicine_custom_url || '');
      })
      .catch(() => setError('No pudimos cargar la configuración.'));
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/tenants/telemed-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telemedicine_enabled: enabled,
          telemedicine_provider: provider,
          telemedicine_custom_url: provider === 'custom_url' ? customUrl.trim() || null : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || data.detail || data.error || 'Error guardando.');
        return;
      }
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  };

  if (!config) return <div className="bg-white border border-zinc-100 rounded-2xl p-6 text-sm text-zinc-500">Cargando…</div>;

  return (
    <div className="space-y-5">
      <section className="bg-white border border-zinc-100 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Video className="w-5 h-5 text-[hsl(var(--brand-blue))]" />
              <h2 className="text-sm font-semibold text-zinc-900">Videoconsultas (telemedicina)</h2>
            </div>
            <p className="text-[12px] text-zinc-500 mt-1 leading-relaxed">
              Cuando esté activo, el bot puede agendar citas como videollamada y mandar el link
              automáticamente al paciente 15 min antes.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition shrink-0 ${
              enabled ? 'bg-[hsl(var(--brand-blue))]' : 'bg-zinc-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${
                enabled ? 'translate-x-5' : ''
              }`}
            />
          </button>
        </div>
      </section>

      {enabled && (
        <section className="bg-white border border-zinc-100 rounded-2xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-zinc-900">Proveedor de videollamada</h2>
          <div className="space-y-2">
            {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => (
              <label
                key={p}
                className={`block rounded-xl p-3 border cursor-pointer transition ${
                  provider === p ? 'bg-[hsl(var(--brand-blue-soft))] border-[hsl(var(--brand-blue))]' : 'bg-white border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="provider"
                    checked={provider === p}
                    onChange={() => setProvider(p)}
                    disabled={p === 'daily'}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900">
                      {PROVIDER_INFO[p].label}
                      {p === 'daily' && (
                        <span className="ml-2 text-[10px] uppercase bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded">
                          Próximamente
                        </span>
                      )}
                    </p>
                    <p className="text-[12px] text-zinc-500 mt-0.5 leading-relaxed">
                      {PROVIDER_INFO[p].description}
                    </p>
                  </div>
                </div>
              </label>
            ))}
          </div>

          {provider === 'custom_url' && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">URL de tu sala</label>
              <input
                type="url"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="https://us04web.zoom.us/j/1234567890"
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm font-mono focus:outline-none focus:border-[hsl(var(--brand-blue))]"
              />
              <p className="text-[11px] text-zinc-400 mt-1">
                Esta URL se manda igual a todos los pacientes. Para salas dinámicas usá Jitsi.
              </p>
            </div>
          )}
        </section>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={saving}
          className="px-5 h-10 bg-[hsl(var(--brand-blue))] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-60 transition"
        >
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
        {savedAt && Date.now() - savedAt < 5_000 && (
          <span className="text-[12px] text-emerald-700">✓ Guardado</span>
        )}
      </div>
    </div>
  );
}
