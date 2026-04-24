import Link from 'next/link';
import { createServerSupabase } from '@/lib/supabase/server';
import {
  Bot, CreditCard, Store, Users, Sliders, Bell, ShieldCheck, Globe,
  ChevronRight, Building2, Workflow, Link2, MapPin, Star,
} from 'lucide-react';

export default async function SettingsHubPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, email, phone, business_type, plan, wa_display_phone, has_chat_agent, has_voice_agent')
    .eq('user_id', user!.id).single();

  const sections = [
    {
      title: 'Agente',
      description: 'Nombre, bienvenida, prompt base y temperatura del modelo.',
      href: '/settings/agent',
      icon: Bot,
      tint: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]',
    },
    {
      title: 'Servicios y precios',
      description: 'Catálogo que el agente menciona al paciente.',
      href: '/settings/services',
      icon: Store,
      tint: 'bg-amber-50 text-amber-600',
    },
    {
      title: 'Equipo',
      description: 'Doctores, staff y permisos de acceso.',
      href: '/settings/team',
      icon: Users,
      tint: 'bg-violet-50 text-violet-600',
    },
    {
      title: 'Facturación y plan',
      description: 'Cambia de plan, métodos de pago y facturas.',
      href: '/settings/billing',
      icon: CreditCard,
      tint: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Página pública de reservas',
      description: 'Link compartible para que nuevos pacientes agenden sin WhatsApp.',
      href: '/settings/booking-links',
      icon: Link2,
      tint: 'bg-rose-50 text-rose-600',
    },
    {
      title: 'Sucursales',
      description: 'Si atendés en más de una dirección. El agente pregunta al paciente en cuál agendar.',
      href: '/settings/locations',
      icon: MapPin,
      tint: 'bg-teal-50 text-teal-600',
    },
    {
      title: 'Reseñas de Google',
      description: 'Reseñas sincronizadas desde Google Business Profile. El bot las consulta antes de pedir una nueva.',
      href: '/settings/reviews',
      icon: Star,
      tint: 'bg-amber-50 text-amber-500',
    },
  ];

  const comingSoon = [
    { title: 'Notificaciones', icon: Bell, description: 'Alertas por email y WhatsApp.' },
    { title: 'Horarios', icon: Sliders, description: 'Días y horas hábiles del consultorio.' },
    { title: 'Integraciones', icon: Workflow, description: 'Calendario, pagos, CRM.' },
    { title: 'Seguridad', icon: ShieldCheck, description: 'Dispositivos y accesos.' },
    { title: 'Dominio', icon: Globe, description: 'Landing page y dominio propio.' },
  ];

  return (
    <div className="space-y-4">
      <header className="animate-element">
        <p className="text-sm text-zinc-500">
          Personaliza tu cuenta, agente y preferencias del consultorio.
        </p>
      </header>

      {/* Business summary */}
      <section className="glass-card p-6 animate-element animate-delay-100">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] text-white flex items-center justify-center shrink-0">
            <Building2 className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-zinc-900">{tenant?.name ?? 'Sin nombre'}</h3>
            <p className="text-xs text-zinc-500 mt-0.5 capitalize">
              {tenant?.business_type?.replace('_', ' ')}
              {tenant?.wa_display_phone ? ` · WhatsApp ${tenant.wa_display_phone}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] font-medium capitalize">
                Plan: {tenant?.plan?.replace('_', ' ') ?? 'free trial'}
              </span>
              {tenant?.has_chat_agent && (
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                  Chat activo
                </span>
              )}
              {tenant?.has_voice_agent && (
                <span className="text-[11px] px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 font-medium">
                  Voz activa
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Main sections */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-element animate-delay-200">
        {sections.map(s => (
          <Link
            key={s.title}
            href={s.href}
            className="glass-card p-5 group flex items-center gap-4 hover:shadow-md transition"
          >
            <span className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${s.tint}`}>
              <s.icon className="w-5 h-5" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-zinc-900">{s.title}</p>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{s.description}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-300 group-hover:text-[hsl(var(--brand-blue))] group-hover:translate-x-0.5 transition" />
          </Link>
        ))}
      </section>

      {/* Coming soon */}
      <section className="animate-element animate-delay-300">
        <h3 className="text-xs uppercase tracking-wider text-zinc-500 font-medium mb-3">Próximamente</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {comingSoon.map(s => (
            <div key={s.title} className="rounded-xl border border-zinc-100 bg-white p-4 opacity-80">
              <s.icon className="w-5 h-5 text-zinc-500" />
              <p className="mt-2 text-[13px] font-medium text-zinc-900">{s.title}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{s.description}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
