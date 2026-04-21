'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type SearchEntry = {
  label: string;
  href: string;
  keywords: string;
  section: string;
};

const ENTRIES: SearchEntry[] = [
  { label: 'Dashboard', href: '/home', section: 'Operación', keywords: 'dashboard inicio home resumen kpi' },
  { label: 'Conversaciones', href: '/conversations', section: 'Operación', keywords: 'conversaciones mensajes chat whatsapp' },
  { label: 'Citas', href: '/appointments', section: 'Operación', keywords: 'citas consultas agenda reservas' },
  { label: 'Calendario', href: '/calendar', section: 'Operación', keywords: 'calendario agenda semana' },
  { label: 'Pacientes', href: '/contacts', section: 'Operación', keywords: 'pacientes contactos clientes' },
  { label: 'Analytics', href: '/analytics', section: 'Operación', keywords: 'analytics analítica métricas reportes' },
  { label: 'Conocimiento', href: '/knowledge', section: 'Conocimiento', keywords: 'conocimiento biblioteca documentos rag' },
  { label: 'Agents', href: '/agents', section: 'AI', keywords: 'agentes agents marketplace automatizaciones' },
  { label: 'Personal AI', href: '/chat-data', section: 'AI', keywords: 'personal ai datos chat pregunta' },
  { label: 'Marketing AI Content', href: '/marketing', section: 'AI', keywords: 'marketing contenido campañas ads' },
  { label: 'Ajustes', href: '/settings', section: 'Config', keywords: 'ajustes configuración settings' },
  { label: 'Facturación', href: '/settings/billing', section: 'Config', keywords: 'facturación billing plan pago suscripción' },
  { label: 'Webhooks', href: '/webhooks', section: 'Config', keywords: 'webhooks integraciones api' },
  { label: 'Privacidad', href: '/settings/privacy', section: 'Config', keywords: 'privacidad privacy datos' },
  { label: 'Términos', href: '/settings/terms', section: 'Config', keywords: 'términos terms legal' },
  { label: 'Contacto', href: '/settings/contact', section: 'Config', keywords: 'contacto soporte ayuda' },
];

function match(query: string, entries: SearchEntry[]): SearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return entries
    .filter((e) => e.label.toLowerCase().includes(q) || e.keywords.includes(q))
    .slice(0, 8);
}

export function AppSearch({
  variant = 'desktop',
  onNavigate,
}: {
  variant?: 'desktop' | 'mobile';
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const results = match(q, ENTRIES);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQ('');
    onNavigate?.();
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && results[highlight]) {
      e.preventDefault();
      go(results[highlight].href);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const isMobile = variant === 'mobile';

  return (
    <div ref={rootRef} className="relative w-full">
      <Search
        className={cn(
          'absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none',
          isMobile ? 'w-4 h-4' : 'w-4 h-4',
        )}
      />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={isMobile ? 'Buscar en la app…' : 'Buscar páginas, ajustes…'}
        className={cn(
          'w-full pl-10 pr-9 text-sm bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))] transition',
          isMobile ? 'h-10 rounded-2xl' : 'h-10 rounded-full',
        )}
      />
      {q && (
        <button
          type="button"
          aria-label="Limpiar"
          onClick={() => {
            setQ('');
            setOpen(false);
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-zinc-400 hover:bg-zinc-100 transition"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}

      {open && q && (
        <div
          className={cn(
            'absolute z-50 mt-2 bg-white border border-zinc-200 rounded-2xl shadow-[0_20px_60px_-12px_rgba(0,0,0,0.18)] overflow-hidden',
            isMobile ? 'inset-x-0' : 'right-0 w-80 lg:w-96',
          )}
        >
          {results.length === 0 ? (
            <div className="px-4 py-5 text-center text-sm text-zinc-500">
              Sin resultados para <span className="text-zinc-700 font-medium">{`"${q}"`}</span>
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((r, i) => (
                <li key={r.href}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => go(r.href)}
                    className={cn(
                      'w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition',
                      i === highlight ? 'bg-[hsl(var(--brand-blue-soft))]' : 'hover:bg-zinc-50',
                    )}
                  >
                    <span className="text-[13.5px] text-zinc-900 font-medium truncate">
                      {r.label}
                    </span>
                    <span className="text-[11px] text-zinc-400 shrink-0">{r.section}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
