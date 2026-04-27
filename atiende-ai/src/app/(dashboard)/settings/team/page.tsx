'use client';

// ═════════════════════════════════════════════════════════════════════════════
// /settings/team
//
// El owner/admin invita a doctores, recepcionistas y otros admins por email.
// Cada invitación dispara un email de Resend con un link a /accept-invite que
// permite al invitado completar registro (nombre + password) y quedar linkeado
// a un staff row con el rol que el owner eligió.
// ═════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback } from 'react';
import { Mail, X, Plus, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { toast } from 'sonner';

type Role = 'admin' | 'doctor' | 'receptionist';

interface StaffRow {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'doctor' | 'receptionist';
  speciality: string | null;
  is_billable: boolean;
  plan: string | null;
  subscription_status: string | null;
  trial_ends_at: string | null;
  accepted_at: string | null;
  user_id: string | null;
}

interface PendingInvite {
  id: string;
  email: string;
  name: string;
  role: Role;
  speciality: string | null;
  expires_at: string;
  created_at: string;
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  doctor: 'Doctor',
  receptionist: 'Recepcionista',
};

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  trialing: { text: 'En trial', color: 'text-blue-700 bg-blue-50' },
  active: { text: 'Activo', color: 'text-green-700 bg-green-50' },
  past_due: { text: 'Pago atrasado', color: 'text-orange-700 bg-orange-50' },
  cancelled: { text: 'Cancelado', color: 'text-zinc-600 bg-zinc-100' },
  unpaid: { text: 'Sin pagar', color: 'text-red-700 bg-red-50' },
};

export default function TeamPage() {
  const [loading, setLoading] = useState(true);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff/list');
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Error cargando equipo');
        return;
      }
      setStaff(json.staff);
      setPending(json.pendingInvitations);
    } catch {
      toast.error('Error de red al cargar equipo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleInvite = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const email = (fd.get('email') as string).trim().toLowerCase();
    const name = (fd.get('name') as string).trim();
    const role = fd.get('role') as Role;
    const speciality = ((fd.get('speciality') as string) || '').trim();
    if (!email || !name || !role) {
      toast.error('Completa email, nombre y rol.');
      return;
    }
    setInviting(true);
    try {
      const res = await fetch('/api/staff/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, role, speciality: speciality || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'No se pudo enviar la invitación.');
        return;
      }
      toast.success(`Invitación enviada a ${email}`);
      setShowInvite(false);
      form.reset();
      load();
    } catch {
      toast.error('Error de red al enviar invitación');
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvite = async (id: string, email: string) => {
    if (!confirm(`¿Cancelar la invitación a ${email}?`)) return;
    try {
      const res = await fetch(`/api/staff/invitations/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'No se pudo cancelar.');
        return;
      }
      toast.success('Invitación cancelada');
      load();
    } catch {
      toast.error('Error de red');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando equipo…
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Equipo</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Invitá a otros doctores, recepcionistas y administradores. Cada uno
            recibe un email para crear su propia cuenta. Los doctores pagan su
            propia suscripción ($599 / $999 / $1499 MXN/mes según el plan).
          </p>
        </div>
        <button
          onClick={() => setShowInvite((v) => !v)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          <Plus className="w-4 h-4" /> Invitar
        </button>
      </div>

      {showInvite && (
        <form
          onSubmit={handleInvite}
          className="bg-white rounded-2xl p-6 ring-1 ring-zinc-200 space-y-4"
        >
          <h2 className="text-base font-semibold text-zinc-900">Nueva invitación</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">
                Email
              </label>
              <input
                name="email"
                type="email"
                required
                placeholder="doctor@ejemplo.com"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">
                Nombre completo
              </label>
              <input
                name="name"
                type="text"
                required
                placeholder="Dra. Pérez García"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">
                Rol
              </label>
              <select
                name="role"
                required
                defaultValue="doctor"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="doctor">Doctor (paga suscripción)</option>
                <option value="admin">Administrador</option>
                <option value="receptionist">Recepcionista</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-zinc-700 block mb-1">
                Especialidad (opcional)
              </label>
              <input
                name="speciality"
                type="text"
                placeholder="Ortodoncia, Endodoncia…"
                className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowInvite(false)}
              className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-600 hover:bg-zinc-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={inviting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {inviting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Mail className="w-4 h-4" />
              )}
              Enviar invitación
            </button>
          </div>
        </form>
      )}

      {pending.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">
            Invitaciones pendientes ({pending.length})
          </h2>
          <div className="bg-white rounded-2xl ring-1 ring-zinc-200 divide-y divide-zinc-100">
            {pending.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-orange-500" />
                  <div>
                    <div className="text-sm font-medium text-zinc-900">
                      {inv.name}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {inv.email} · {ROLE_LABEL[inv.role]}
                      {inv.speciality ? ` · ${inv.speciality}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleCancelInvite(inv.id, inv.email)}
                  className="text-zinc-400 hover:text-red-600 p-1"
                  title="Cancelar invitación"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold text-zinc-700 mb-3">
          Equipo activo ({staff.length})
        </h2>
        <div className="bg-white rounded-2xl ring-1 ring-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Nombre</th>
                <th className="text-left px-4 py-3 font-medium">Rol</th>
                <th className="text-left px-4 py-3 font-medium">Plan</th>
                <th className="text-left px-4 py-3 font-medium">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {staff.map((s) => {
                const status = s.subscription_status
                  ? STATUS_LABEL[s.subscription_status]
                  : null;
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-zinc-900">{s.name}</div>
                      <div className="text-xs text-zinc-500">
                        {s.email || '—'}
                        {s.speciality ? ` · ${s.speciality}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {ROLE_LABEL[s.role] || s.role}
                    </td>
                    <td className="px-4 py-3 text-zinc-700">
                      {s.is_billable
                        ? s.plan === 'trialing'
                          ? 'Trial'
                          : s.plan
                            ? s.plan.charAt(0).toUpperCase() + s.plan.slice(1)
                            : '—'
                        : 'No aplica'}
                    </td>
                    <td className="px-4 py-3">
                      {!s.is_billable ? (
                        <span className="text-xs text-zinc-400">—</span>
                      ) : status ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${status.color}`}
                        >
                          {s.subscription_status === 'active' && (
                            <CheckCircle2 className="w-3 h-3" />
                          )}
                          {status.text}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">Sin suscripción</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
