'use client';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Calendar,
  UserX,
  UserPlus,
  Zap,
  MessageSquare,
} from 'lucide-react';
import Link from 'next/link';

interface IndustryDashProps {
  tenant: Record<string, unknown>;
  roi: {
    messagesSaved: number;
    hoursSaved: number;
    totalSavingsMXN: number;
    roiPercent: number;
    monthlyCostMXN: number;
  };
  todayData: Record<string, number> | null;
  monthData: Record<string, number>[];
  appointments: Record<string, unknown>[];
  conversations: Record<string, unknown>[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(n);

/* ---------- tiny KPI card ---------- */
function KPI({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="border-zinc-200/60 shadow-sm">
      <div className="p-4">
        <Icon className="w-4 h-4 text-zinc-400 mb-2" />
        <p className="text-[11px] uppercase tracking-wider text-zinc-400">
          {label}
        </p>
        <p className="text-2xl font-bold text-zinc-900 tabular-nums">
          {value}
        </p>
      </div>
    </Card>
  );
}

/* ---------- main export ---------- */
export function DashboardDental({
  roi,
  todayData,
  monthData,
  appointments,
  conversations,
}: IndustryDashProps) {
  /* ---- derived data ---- */
  const citasHoy = (todayData?.appointments_booked as number) || 0;

  const noShowsMes = monthData.reduce(
    (acc, d) => acc + ((d.appointments_no_show as number) || 0),
    0,
  );

  const pacientesNuevos = monthData.reduce(
    (acc, d) => acc + ((d.leads_new as number) || 0),
    0,
  );

  /* ---- sort today's appointments by time ---- */
  const todayAppointments = [...appointments].sort((a, b) => {
    const ta = new Date(a.datetime as string).getTime();
    const tb = new Date(b.datetime as string).getTime();
    return ta - tb;
  });

  return (
    <div className="space-y-6">
      {/* ---- FILA 1: KPI cards ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI icon={Calendar} label="Citas hoy" value={citasHoy} />
        <KPI icon={UserX} label="No-shows mes" value={noShowsMes} />
        <KPI icon={UserPlus} label="Pacientes nuevos" value={pacientesNuevos} />
        <KPI icon={Zap} label="Msgs ahorrados" value={roi.messagesSaved} />
      </div>

      {/* ---- FILA 2: two-column grid ---- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column — Citas de hoy timeline */}
        <Card className="lg:col-span-2 border-zinc-200/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-zinc-900">
              <Calendar className="w-4 h-4 text-zinc-400" />
              Citas de hoy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {todayAppointments.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-8">
                Sin citas programadas hoy
              </p>
            ) : (
              todayAppointments.map((apt) => {
                const dt = new Date(apt.datetime as string);
                const time = dt.toLocaleTimeString('es-MX', {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const name =
                  (apt.customer_name as string) ||
                  (apt.customer_phone as string) ||
                  'Paciente';
                const service =
                  (apt.services as Record<string, unknown>)?.name as
                    | string
                    | undefined;

                return (
                  <div
                    key={apt.id as string}
                    className="flex items-start gap-3 p-3 rounded-lg hover:bg-zinc-50 transition-colors"
                  >
                    <span className="text-sm font-bold text-zinc-900 shrink-0 w-12 tabular-nums">
                      {time}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-700 truncate">{name}</p>
                      {service && (
                        <p className="text-xs text-zinc-400 truncate">
                          {service}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Right column — WhatsApp recientes */}
        <Card className="border-zinc-200/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-zinc-900">
              <MessageSquare className="w-4 h-4 text-zinc-400" />
              WhatsApp recientes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {conversations.length === 0 ? (
              <p className="text-xs text-zinc-400 text-center py-8">
                Sin conversaciones aun
              </p>
            ) : (
              conversations.slice(0, 5).map((c) => (
                <Link
                  key={c.id as string}
                  href={`/conversations/${c.id}`}
                  className="block p-2 rounded-lg hover:bg-zinc-50 transition-colors"
                >
                  <p className="text-sm font-medium text-zinc-900 truncate">
                    {(c.customer_name as string) ||
                      (c.customer_phone as string)}
                  </p>
                  <p className="text-xs text-zinc-400 truncate">
                    {(
                      (c.messages as Record<string, unknown>[])?.[
                        ((c.messages as Record<string, unknown>[])?.length ??
                          1) - 1
                      ]?.content as string
                    )?.substring(0, 50) || 'Sin msgs'}
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
