'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, Check, ExternalLink, Plus, Trash2, Power } from 'lucide-react';
import { toast } from 'sonner';

interface BookingLink {
  id: string;
  slug: string;
  staff_id: string | null;
  enabled: boolean;
  monthly_bookings_cap: number;
  link_expires_at: string | null;
  heading: string | null;
  subheading: string | null;
  brand_color_hex: string | null;
  created_at: string;
  last_booking_at: string | null;
}

interface Staff {
  id: string;
  name: string;
  role: string | null;
}

interface Props {
  tenantName: string;
  baseUrl: string;
  staff: Staff[];
  initialLinks: BookingLink[];
}

function defaultSlug(tenantName: string): string {
  return tenantName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function BookingLinksManager({ tenantName, baseUrl, staff, initialLinks }: Props) {
  const [links, setLinks] = useState<BookingLink[]>(initialLinks);
  const [editing, setEditing] = useState<Partial<BookingLink> | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const openCreate = () => {
    setEditing({
      slug: defaultSlug(tenantName),
      enabled: true,
      monthly_bookings_cap: 100,
      staff_id: null,
      heading: '',
      subheading: `Agenda tu cita con ${tenantName}`,
      brand_color_hex: '#2563eb',
    });
  };

  const openEdit = (link: BookingLink) => setEditing({ ...link });

  const save = async () => {
    if (!editing || !editing.slug) return;
    setSaving(true);
    try {
      const res = await fetch('/api/booking-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(
          data.error === 'slug_taken'
            ? 'Ese slug ya está usado, probá otro.'
            : data.error === 'invalid_params'
              ? 'Revisá los datos del formulario.'
              : 'No se pudo guardar.',
        );
        return;
      }
      // Refresca data desde server
      const listRes = await fetch('/api/booking-links');
      const listData = await listRes.json();
      setLinks(listData.links || []);
      setEditing(null);
      toast.success(editing.id ? 'Link actualizado.' : 'Link creado.');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (link: BookingLink) => {
    const res = await fetch('/api/booking-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: link.id, slug: link.slug, enabled: !link.enabled }),
    });
    if (!res.ok) {
      toast.error('No se pudo cambiar el estado.');
      return;
    }
    setLinks((ls) => ls.map((l) => (l.id === link.id ? { ...l, enabled: !l.enabled } : l)));
    toast.success(link.enabled ? 'Link desactivado.' : 'Link activado.');
  };

  const remove = async (link: BookingLink) => {
    if (!confirm(`¿Eliminar el link "${link.slug}"? Esta acción no se puede deshacer.`)) return;
    const res = await fetch(`/api/booking-links?id=${encodeURIComponent(link.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toast.error('No se pudo eliminar.');
      return;
    }
    setLinks((ls) => ls.filter((l) => l.id !== link.id));
    toast.success('Link eliminado.');
  };

  const copyUrl = async (slug: string, id: string) => {
    const url = `${baseUrl}/book/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1600);
      toast.success('URL copiada.');
    } catch {
      toast.error('No se pudo copiar. Copialo manualmente: ' + url);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-4">
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
          <ArrowLeft className="w-4 h-4" /> Volver
        </Link>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full bg-[hsl(var(--brand-blue))] text-white text-sm font-medium hover:opacity-90 transition"
        >
          <Plus className="w-4 h-4" /> Nuevo link
        </button>
      </header>

      <div className="glass-card p-5">
        <h1 className="text-lg font-semibold text-zinc-900">Página pública de reservas</h1>
        <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
          Cada link te da una URL pública (<code>{baseUrl}/book/&lt;slug&gt;</code>) que podés
          compartir en Google Business Profile, Instagram, tarjetas, etc. Cualquier paciente
          agenda sin necesidad de iniciar conversación por WhatsApp.
        </p>
      </div>

      {links.length === 0 && (
        <div className="glass-card py-12 text-center text-sm text-zinc-500">
          No tenés links creados. <button onClick={openCreate} className="text-[hsl(var(--brand-blue))] underline">Crear el primero</button>.
        </div>
      )}

      <div className="space-y-3">
        {links.map((link) => {
          const url = `${baseUrl}/book/${link.slug}`;
          const staffName = link.staff_id ? staff.find((s) => s.id === link.staff_id)?.name : null;
          return (
            <div key={link.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[13px] text-zinc-900 font-medium">/book/{link.slug}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        link.enabled
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-zinc-100 text-zinc-500'
                      }`}
                    >
                      {link.enabled ? 'Activo' : 'Inactivo'}
                    </span>
                    {link.link_expires_at && new Date(link.link_expires_at) < new Date() && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-medium">
                        Expirado
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-zinc-500 mt-1 truncate">
                    {staffName ? `Solo ${staffName}` : 'Cualquier doctor activo'}
                    {' · '} Tope: {link.monthly_bookings_cap}/mes
                    {link.last_booking_at && (
                      <> · Última cita: {new Date(link.last_booking_at).toLocaleDateString('es-MX')}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => copyUrl(link.slug, link.id)}
                    title="Copiar URL"
                    className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-600"
                  >
                    {copiedId === link.id ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    title="Abrir"
                    className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-600"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                  <button
                    onClick={() => toggleEnabled(link)}
                    title={link.enabled ? 'Desactivar' : 'Activar'}
                    className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-600"
                  >
                    <Power className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEdit(link)}
                    className="px-3 h-8 rounded-lg text-[12px] font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => remove(link)}
                    title="Eliminar"
                    className="p-2 rounded-lg hover:bg-rose-50 text-rose-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 space-y-4 max-h-[92vh] overflow-auto">
            <h3 className="text-lg font-semibold text-zinc-900">
              {editing.id ? 'Editar link' : 'Nuevo link'}
            </h3>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Slug (URL)</label>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-zinc-400 whitespace-nowrap">{baseUrl}/book/</span>
                <input
                  type="text"
                  value={editing.slug || ''}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                  className="flex-1 h-10 px-3 rounded-lg border border-zinc-200 text-sm font-mono"
                />
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">Solo minúsculas, números y guiones. Mínimo 3, máx 64.</p>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Título (opcional)</label>
              <input
                type="text"
                value={editing.heading || ''}
                onChange={(e) => setEditing({ ...editing, heading: e.target.value })}
                placeholder="Agenda tu cita con Dr. X"
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Subtítulo (opcional)</label>
              <input
                type="text"
                value={editing.subheading || ''}
                onChange={(e) => setEditing({ ...editing, subheading: e.target.value })}
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Doctor</label>
                <select
                  value={editing.staff_id || ''}
                  onChange={(e) => setEditing({ ...editing, staff_id: e.target.value || null })}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                >
                  <option value="">Cualquiera activo</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Tope mensual</label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={editing.monthly_bookings_cap ?? 100}
                  onChange={(e) => setEditing({ ...editing, monthly_bookings_cap: Number(e.target.value) || 100 })}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Color (brand)</label>
              <input
                type="color"
                value={editing.brand_color_hex || '#2563eb'}
                onChange={(e) => setEditing({ ...editing, brand_color_hex: e.target.value })}
                className="h-10 w-16 rounded-lg border border-zinc-200"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="enabled"
                checked={editing.enabled ?? true}
                onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
              />
              <label htmlFor="enabled" className="text-sm text-zinc-700">Link activo</label>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="px-4 h-9 rounded-lg text-sm text-zinc-700 hover:bg-zinc-100"
              >
                Cancelar
              </button>
              <button
                onClick={save}
                disabled={saving || !editing.slug || editing.slug.length < 3}
                className="px-4 h-9 rounded-lg text-sm text-white bg-[hsl(var(--brand-blue))] hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
