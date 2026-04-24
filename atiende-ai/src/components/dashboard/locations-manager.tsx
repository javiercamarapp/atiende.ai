'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, MapPin, Plus, Star, Trash2, Power } from 'lucide-react';
import { toast } from 'sonner';

interface Staff {
  id: string;
  name: string;
  role: string | null;
  active: boolean;
}

interface Location {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
  phone: string | null;
  timezone: string | null;
  business_hours: Record<string, string> | null;
  is_primary: boolean;
  active: boolean;
  staff_ids: string[];
}

interface Props {
  tenantTimezone: string;
  staff: Staff[];
  initialLocations: Location[];
}

const DAYS: Array<{ key: string; label: string }> = [
  { key: 'lun', label: 'Lun' },
  { key: 'mar', label: 'Mar' },
  { key: 'mie', label: 'Mié' },
  { key: 'jue', label: 'Jue' },
  { key: 'vie', label: 'Vie' },
  { key: 'sab', label: 'Sáb' },
  { key: 'dom', label: 'Dom' },
];

type EditingLocation = Partial<Location>;

export function LocationsManager({ tenantTimezone, staff, initialLocations }: Props) {
  const [locations, setLocations] = useState<Location[]>(initialLocations);
  const [editing, setEditing] = useState<EditingLocation | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => {
    setEditing({
      name: '',
      address: '',
      city: '',
      country: 'MX',
      timezone: tenantTimezone,
      business_hours: { lun: '09:00-18:00', mar: '09:00-18:00', mie: '09:00-18:00', jue: '09:00-18:00', vie: '09:00-18:00' },
      is_primary: locations.length === 0, // first location is primary by default
      active: true,
      staff_ids: [],
    });
  };

  const openEdit = (loc: Location) => setEditing({ ...loc });

  const refresh = async () => {
    const res = await fetch('/api/locations');
    const data = await res.json();
    setLocations(data.locations || []);
  };

  const save = async () => {
    if (!editing || !editing.name || editing.name.trim().length < 2) return;
    setSaving(true);
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error === 'invalid_params' ? 'Datos inválidos.' : 'No se pudo guardar.');
        return;
      }
      await refresh();
      setEditing(null);
      toast.success(editing.id ? 'Sucursal actualizada.' : 'Sucursal creada.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (loc: Location) => {
    if (!confirm(`¿Eliminar la sucursal "${loc.name}"? Las citas ya agendadas perderán su referencia a esta sede pero se conservarán.`)) return;
    const res = await fetch(`/api/locations?id=${encodeURIComponent(loc.id)}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('No se pudo eliminar.'); return; }
    setLocations((ls) => ls.filter((l) => l.id !== loc.id));
    toast.success('Sucursal eliminada.');
  };

  const toggleActive = async (loc: Location) => {
    const res = await fetch('/api/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: loc.id, name: loc.name, active: !loc.active }),
    });
    if (!res.ok) { toast.error('No se pudo cambiar el estado.'); return; }
    setLocations((ls) => ls.map((l) => (l.id === loc.id ? { ...l, active: !l.active } : l)));
  };

  const toggleStaff = (id: string) => {
    if (!editing) return;
    const ids = editing.staff_ids ?? [];
    setEditing({
      ...editing,
      staff_ids: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    });
  };

  const setHours = (day: string, value: string) => {
    if (!editing) return;
    const hours = { ...(editing.business_hours || {}) };
    if (value.trim() === '' || value === 'cerrado') {
      delete hours[day];
    } else {
      hours[day] = value;
    }
    setEditing({ ...editing, business_hours: hours });
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
          <Plus className="w-4 h-4" /> Nueva sucursal
        </button>
      </header>

      <div className="glass-card p-5">
        <h1 className="text-lg font-semibold text-zinc-900">Sucursales</h1>
        <p className="text-sm text-zinc-500 mt-1 leading-relaxed">
          Si tu consultorio atiende en más de una dirección, creá una sucursal por cada una. El agente va a preguntarle al paciente cuál elige antes de agendar. Si solo tenés una, no hace falta configurar nada.
        </p>
      </div>

      {locations.length === 0 && (
        <div className="glass-card py-12 text-center text-sm text-zinc-500">
          Aún no tenés sucursales. <button onClick={openCreate} className="text-[hsl(var(--brand-blue))] underline">Crear la primera</button>.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {locations.map((loc) => {
          const assigned = staff.filter((s) => loc.staff_ids.includes(s.id));
          return (
            <div key={loc.id} className="glass-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="font-semibold text-zinc-900">{loc.name}</span>
                    {loc.is_primary && (
                      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                        <Star className="w-2.5 h-2.5 fill-amber-500" /> Principal
                      </span>
                    )}
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        loc.active ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'
                      }`}
                    >
                      {loc.active ? 'Activa' : 'Inactiva'}
                    </span>
                  </div>
                  <p className="text-[12px] text-zinc-600 mt-1.5">
                    {loc.address ?? '—'}{loc.city ? `, ${loc.city}` : ''}
                  </p>
                  {assigned.length > 0 ? (
                    <p className="text-[11px] text-zinc-400 mt-1.5">
                      {assigned.map((s) => s.name).join(', ')}
                    </p>
                  ) : (
                    <p className="text-[11px] text-rose-600 mt-1.5">Sin doctores asignados — el agente no podrá agendar aquí.</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleActive(loc)}
                    title={loc.active ? 'Desactivar' : 'Activar'}
                    className="p-2 rounded-lg hover:bg-zinc-100 text-zinc-600"
                  >
                    <Power className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => openEdit(loc)}
                    className="px-3 h-8 rounded-lg text-[12px] font-medium bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => remove(loc)}
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
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl p-6 space-y-4 max-h-[92vh] overflow-auto">
            <h3 className="text-lg font-semibold text-zinc-900">
              {editing.id ? 'Editar sucursal' : 'Nueva sucursal'}
            </h3>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Nombre</label>
              <input
                type="text"
                value={editing.name || ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Consultorio Polanco"
                className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Dirección</label>
                <input
                  type="text"
                  value={editing.address || ''}
                  onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                  placeholder="Av. Horacio 345, piso 3"
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Ciudad</label>
                <input
                  type="text"
                  value={editing.city || ''}
                  onChange={(e) => setEditing({ ...editing, city: e.target.value })}
                  placeholder="CDMX"
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Estado</label>
                <input
                  type="text"
                  value={editing.state || ''}
                  onChange={(e) => setEditing({ ...editing, state: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Teléfono</label>
                <input
                  type="tel"
                  value={editing.phone || ''}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Zona horaria</label>
                <input
                  type="text"
                  value={editing.timezone || ''}
                  onChange={(e) => setEditing({ ...editing, timezone: e.target.value })}
                  placeholder={tenantTimezone}
                  className="w-full h-10 px-3 rounded-lg border border-zinc-200 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">Horarios (formato "09:00-18:00"; vacío = cerrado)</label>
              <div className="grid grid-cols-7 gap-1.5">
                {DAYS.map((d) => (
                  <div key={d.key} className="text-center">
                    <div className="text-[10px] text-zinc-500 mb-1">{d.label}</div>
                    <input
                      type="text"
                      value={(editing.business_hours && editing.business_hours[d.key]) || ''}
                      onChange={(e) => setHours(d.key, e.target.value)}
                      placeholder="09:00-18:00"
                      className="w-full h-8 px-1.5 rounded-md border border-zinc-200 text-[11px] text-center"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">Doctores que atienden aquí</label>
              <div className="flex flex-wrap gap-2">
                {staff.filter((s) => s.active).map((s) => {
                  const on = (editing.staff_ids ?? []).includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleStaff(s.id)}
                      className={`px-3 h-8 rounded-full text-[12px] font-medium transition ${
                        on
                          ? 'bg-[hsl(var(--brand-blue))] text-white'
                          : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                      }`}
                    >
                      {s.name}
                    </button>
                  );
                })}
                {staff.filter((s) => s.active).length === 0 && (
                  <p className="text-[12px] text-zinc-500">No tenés doctores activos. Creá alguno en /settings/team primero.</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={editing.is_primary ?? false}
                  onChange={(e) => setEditing({ ...editing, is_primary: e.target.checked })}
                /> Sede principal
              </label>
              <label className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={editing.active ?? true}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                /> Activa
              </label>
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
                disabled={saving || !editing.name || editing.name.trim().length < 2}
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
