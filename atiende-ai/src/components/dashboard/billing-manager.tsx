'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Briefcase,
  Calendar,
  Check,
  ChevronDown,
  Clock,
  Code,
  CreditCard,
  DollarSign,
  Download,
  FileText,
  Hash,
  Headphones,
  Loader2,
  Mail,
  MessageCircle,
  MessageSquare,
  Mic,
  PenTool,
  Phone,
  PhoneCall,
  RefreshCw,
  Rocket,
  Send,
  Shield,
  Sparkles,
  Sun,
  TrendingUp,
  Unlock,
  User,
  UserCheck,
  UserPlus,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

interface Feature {
  icon: LucideIcon;
  text: string;
}

interface Plan {
  key: 'basic' | 'pro' | 'premium';
  name: string;
  price: number;
  msgLimit: number;
  tagline: string;
  tierIcon: LucideIcon;
  popular?: boolean;
  features: Feature[];
}

const PLANS: Plan[] = [
  {
    key: 'basic',
    name: 'Esencial',
    price: 599,
    msgLimit: 500,
    tagline: 'Ideal para empezar',
    tierIcon: MessageSquare,
    features: [
      { icon: MessageSquare, text: 'Mensajes entrantes de WhatsApp ilimitados' },
      { icon: Sparkles, text: 'Agente con IA entrenado para tu consultorio' },
      { icon: Calendar, text: 'Agenda integrada con Google Calendar' },
      { icon: Bell, text: 'Recordatorios automáticos de cita' },
      { icon: Clock, text: 'Responde 24/7 en español natural' },
      { icon: Hash, text: '1 número de WhatsApp Business conectado' },
      { icon: BookOpen, text: 'Knowledge base personalizable' },
      { icon: UserCheck, text: 'Handoff inteligente a tu recepcionista' },
      { icon: BarChart3, text: 'Dashboard con métricas de conversaciones' },
      { icon: User, text: '1 usuario administrador' },
      { icon: Zap, text: 'Onboarding auto-deploy en menos de 24h' },
      { icon: Unlock, text: 'Sin contratos anuales, cancelas cuando quieras' },
      { icon: Mail, text: 'Soporte por email en menos de 24h' },
    ],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 999,
    msgLimit: 2000,
    popular: true,
    tagline: 'Para consultorios que ya escalaron',
    tierIcon: Sparkles,
    features: [
      { icon: Check, text: 'Todo lo del plan Esencial' },
      { icon: Sun, text: 'Briefing diario a las 8am con tu agenda' },
      { icon: Mic, text: 'Voice notes a acciones: dicta y la IA ejecuta' },
      { icon: PenTool, text: 'Contenido para Instagram, Facebook y blog' },
      { icon: RefreshCw, text: 'Reactivación de pacientes inactivos (+6 meses)' },
      { icon: Send, text: '500 mensajes salientes para campañas' },
      { icon: TrendingUp, text: 'Reporte semanal con métricas clave' },
      { icon: Download, text: 'Dashboard avanzado con exports a Excel' },
      { icon: Users, text: '3 usuarios con permisos granulares' },
      { icon: FileText, text: 'Templates de WhatsApp pre-aprobados (hasta 10)' },
      { icon: Headphones, text: 'Soporte prioritario por WhatsApp' },
    ],
  },
  {
    key: 'premium',
    name: 'Ultimate',
    price: 1499,
    msgLimit: 10000,
    tagline: 'Con Valeria, tu secretaria de voz IA',
    tierIcon: Phone,
    features: [
      { icon: Check, text: 'Todo lo del plan Pro' },
      { icon: Phone, text: 'Valeria: secretaria de voz con IA, 24/7' },
      { icon: Clock, text: '300 minutos de voz incluidos' },
      { icon: PhoneCall, text: 'Llamadas entrantes y salientes automatizadas' },
      { icon: DollarSign, text: 'Minuto adicional de voz a $5 MXN' },
      { icon: CreditCard, text: 'Links de pago dentro del chat' },
      { icon: Code, text: 'API completa para integraciones custom' },
      { icon: UserPlus, text: 'Usuarios administradores ilimitados' },
      { icon: Rocket, text: 'Onboarding 1:1 con especialista (2h)' },
      { icon: Briefcase, text: 'Account manager dedicado' },
      { icon: Shield, text: 'Alta disponibilidad con monitoreo 24/7' },
      { icon: MessageCircle, text: 'Soporte 24/7 por WhatsApp y llamada' },
    ],
  },
];

const VISIBLE_FEATURES = 4;

function getPlanInfo(key: string): Plan | undefined {
  return PLANS.find((p) => p.key === key);
}

function usageGradient(pct: number): string {
  if (pct >= 90) return 'from-orange-500 to-red-500';
  if (pct >= 71) return 'from-amber-400 to-orange-500';
  return 'from-[hsl(235,84%,60%)] to-[hsl(235,84%,50%)]';
}

export function BillingManager({ tenant }: { tenant: Record<string, unknown> | null }) {
  const [loading, setLoading] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [usage, setUsage] = useState<{ count: number } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const tenantPlan = (tenant?.plan as string) || 'free_trial';
  const tenantId = tenant?.id as string;
  const hasCustomer = Boolean(tenant?.stripe_customer_id as string);
  const trialEndsAt = tenant?.trial_ends_at as string | null | undefined;
  const isTrialing = tenantPlan === 'free_trial';

  const fetchUsage = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/billing/usage?tenantId=${tenantId}`);
      if (res.ok) {
        const data = await res.json();
        setUsage(data);
      }
    } catch {
      // non-critical
    }
  }, [tenantId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Deep-link support: si llegamos desde /marketing o /chat-data con
  // ?plan=pro (o basic/premium), scrolleamos la card del plan al centro
  // y le ponemos un ring de highlight 2s. Mejor UX que caer en el tope
  // del dashboard y tener que buscar el plan.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const target = params.get('plan');
    if (!target || !['basic', 'pro', 'premium'].includes(target)) return;
    const el = document.getElementById(`plan-${target}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-[hsl(var(--brand-blue))]', 'ring-offset-2');
    const timer = setTimeout(() => {
      el.classList.remove('ring-2', 'ring-[hsl(var(--brand-blue))]', 'ring-offset-2');
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const upgrade = async (plan: string) => {
    setLoading(plan);
    try {
      const r = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        const msg = body?.error || 'Error al procesar el pago';
        toast.error(msg);
        return;
      }
      const d = await r.json();
      if (d.url) window.location.href = d.url;
    } catch {
      toast.error('Error de conexión. Intenta de nuevo.');
    } finally {
      setLoading('');
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      const r = await fetch('/api/billing/cancel', { method: 'POST' });
      if (!r.ok) {
        toast.error('No se pudo cancelar. Intenta desde el portal de facturación.');
        return;
      }
      toast.success('Suscripción cancelada al fin del periodo actual.');
      setCancelOpen(false);
      window.location.reload();
    } finally {
      setCancelling(false);
    }
  };

  const openPortal = async () => {
    setLoading('portal');
    try {
      const r = await fetch('/api/billing/portal', { method: 'POST' });
      const d = await r.json();
      if (d.url) window.location.href = d.url;
    } finally {
      setLoading('');
    }
  };

  const currentPlan = getPlanInfo(tenantPlan);
  const limit = currentPlan?.msgLimit ?? 50;
  const usedCount = usage?.count ?? 0;
  const usagePercent = limit > 0 ? Math.min(100, Math.round((usedCount / limit) * 100)) : 0;
  const remaining = Math.max(0, limit - usedCount);
  const usageColor = useMemo(() => usageGradient(usagePercent), [usagePercent]);

  const trialDaysLeft = useMemo(() => {
    if (!trialEndsAt) return null;
    const diff = new Date(trialEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(diff / 86400000));
  }, [trialEndsAt]);

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="space-y-5">
      {/* Hero — current plan + usage */}
      <div className="stagger-item glass-card p-5 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-20 -right-20 w-52 h-52 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 blur-3xl opacity-60 pointer-events-none"
        />
        <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Current plan */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gradient-to-br from-blue-50 to-indigo-50 ring-1 ring-blue-100">
                {isTrialing ? (
                  <Sparkles className="w-4.5 h-4.5 text-blue-600" />
                ) : currentPlan ? (
                  <currentPlan.tierIcon className="w-4.5 h-4.5 text-blue-600" />
                ) : (
                  <Sparkles className="w-4.5 h-4.5 text-blue-600" />
                )}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  Plan actual
                </p>
                <p className="text-lg font-semibold text-zinc-900 leading-tight">
                  {isTrialing ? 'Prueba gratuita' : currentPlan?.name ?? tenantPlan}
                </p>
              </div>
            </div>

            {!isTrialing && currentPlan && (
              <p className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-900">
                  ${currentPlan.price.toLocaleString('es-MX')} MXN
                </span>{' '}
                / mes
              </p>
            )}

            {isTrialing && trialDaysLeft !== null && (
              <div
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                  trialDaysLeft <= 3
                    ? 'bg-red-50 text-red-700 ring-1 ring-red-100'
                    : 'bg-amber-50 text-amber-800 ring-1 ring-amber-100'
                }`}
              >
                <Clock className="w-3 h-3" />
                {trialDaysLeft > 0
                  ? `${trialDaysLeft} día${trialDaysLeft !== 1 ? 's' : ''} restantes`
                  : 'Tu prueba terminó — elige un plan abajo'}
              </div>
            )}

            {hasCustomer && (
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <CreditCard className="w-3 h-3" />
                <span>Método de pago registrado</span>
              </div>
            )}
          </div>

          {/* Info del estado del plan. Ya no mostramos usage meter porque
              todos los planes ahora son ilimitados (v4 — ver
              PLAN_MSG_LIMITS_MONTHLY en config.ts). El card simplemente
              describe el estado del trial o ratifica que los mensajes
              están sin límite en el plan activo. */}
          {isTrialing ? (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  Prueba gratuita
                </p>
                <p className="text-[11px] text-zinc-500">
                  {trialDaysLeft !== null && trialDaysLeft > 0
                    ? `${trialDaysLeft} día${trialDaysLeft !== 1 ? 's' : ''} restantes`
                    : 'Activa cualquier plan'}
                </p>
              </div>
              <p className="text-[11px] text-zinc-600 leading-relaxed">
                Primer mes gratis. Al activar un plan te pedimos tu tarjeta:
                no se cobra nada hasta el día 31. Podés cancelar cuando
                quieras desde esta página.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                  Tu plan
                </p>
                <p className="text-[11px] text-emerald-700 font-medium">
                  Mensajes ilimitados
                </p>
              </div>
              <p className="text-[11px] text-zinc-600 leading-relaxed">
                Sin cap mensual ni costos por mensaje. Tu plan incluye todos
                los mensajes que necesite tu consultorio.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Plan grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:items-start">
        {PLANS.map((plan, idx) => {
          const isCurrent = tenantPlan === plan.key;
          const isLoading = loading === plan.key;
          const isDark = plan.key === 'premium';
          const isPopular = Boolean(plan.popular);
          const TierIcon = plan.tierIcon;
          const isExpanded = expanded[plan.key] ?? false;
          const visibleFeatures = isExpanded
            ? plan.features
            : plan.features.slice(0, VISIBLE_FEATURES);
          const hiddenCount = plan.features.length - VISIBLE_FEATURES;

          const baseCard =
            'stagger-item relative flex flex-col rounded-[var(--radius)] p-5 transition-all duration-300 hover:-translate-y-0.5';
          const themeCard = isDark
            ? 'bg-zinc-900 text-white shadow-xl hover:shadow-2xl ring-1 ring-zinc-800'
            : isPopular
              ? 'bg-white shadow-md hover:shadow-xl ring-2 ring-[hsl(235_84%_55%)] lg:scale-[1.02]'
              : 'bg-white shadow-sm hover:shadow-lg ring-1 ring-zinc-200';
          const currentBorder =
            isCurrent && !isDark && !isPopular
              ? ' ring-2 ring-[hsl(235_84%_55%)]'
              : '';

          return (
            <div
              key={plan.key}
              id={`plan-${plan.key}`}
              className={`${baseCard} ${themeCard}${currentBorder}`}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <span className="inline-flex items-center gap-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[10px] font-semibold px-2.5 py-0.5 rounded-full shadow-lg tracking-wide">
                    <Sparkles className="w-2.5 h-2.5" />
                    Más popular
                  </span>
                </div>
              )}

              {isCurrent && (
                <div className="absolute top-2.5 right-2.5">
                  <span
                    className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      isDark
                        ? 'bg-white/10 text-white ring-1 ring-white/20'
                        : 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                    }`}
                  >
                    <Check className="w-2.5 h-2.5" />
                    Tu plan
                  </span>
                </div>
              )}

              {/* Header */}
              <div className="flex items-center gap-2.5 mb-0.5">
                <div
                  className={`p-1.5 rounded-full ${
                    isDark
                      ? 'bg-white/10 ring-1 ring-white/10'
                      : isPopular
                        ? 'bg-gradient-to-br from-blue-50 to-indigo-50 ring-1 ring-blue-100'
                        : 'bg-zinc-50 ring-1 ring-zinc-100'
                  }`}
                >
                  <TierIcon
                    className={`w-4 h-4 ${
                      isDark
                        ? 'text-indigo-300'
                        : isPopular
                          ? 'text-blue-600'
                          : 'text-zinc-700'
                    }`}
                  />
                </div>
                <h4
                  className={`text-base font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}
                >
                  {plan.name}
                </h4>
              </div>

              <p className={`text-[11px] mb-3 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                {plan.tagline}
              </p>

              {/* Price */}
              <div className="mb-4">
                <div className="flex items-baseline gap-1">
                  <span
                    className={`text-3xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-zinc-900'}`}
                  >
                    ${plan.price.toLocaleString('es-MX')}
                  </span>
                  <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                    MXN/mes
                  </span>
                </div>
                <p className={`text-[11px] mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  Mensajes ilimitados
                </p>
                {isTrialing && !isCurrent && (
                  <p className={`text-[11px] mt-1.5 font-medium ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                    ✨ Primer mes gratis — se requiere tarjeta, no se cobra hasta el día 31
                  </p>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-2 mb-4 flex-1">
                {visibleFeatures.map((f, i) => {
                  const FeatureIcon = f.icon;
                  return (
                    <li
                      key={`${plan.key}-${i}`}
                      className={`flex items-start gap-2 text-[13px] leading-snug ${
                        isDark ? 'text-zinc-200' : 'text-zinc-700'
                      }`}
                    >
                      <FeatureIcon
                        className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                          isDark
                            ? 'text-indigo-300'
                            : isPopular
                              ? 'text-blue-600'
                              : 'text-zinc-500'
                        }`}
                      />
                      <span>{f.text}</span>
                    </li>
                  );
                })}
              </ul>

              {!isExpanded && hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => toggleExpanded(plan.key)}
                  className={`inline-flex items-center gap-1 text-[12px] font-medium mb-4 transition-colors ${
                    isDark
                      ? 'text-indigo-300 hover:text-indigo-200'
                      : isPopular
                        ? 'text-blue-600 hover:text-blue-700'
                        : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                  Ver {hiddenCount} más
                </button>
              )}

              {isExpanded && hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => toggleExpanded(plan.key)}
                  className={`inline-flex items-center gap-1 text-[12px] font-medium mb-4 transition-colors ${
                    isDark
                      ? 'text-indigo-300 hover:text-indigo-200'
                      : isPopular
                        ? 'text-blue-600 hover:text-blue-700'
                        : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  <ChevronDown className="w-3.5 h-3.5 rotate-180 transition-transform" />
                  Ver menos
                </button>
              )}

              {/* CTA */}
              {isCurrent ? (
                <div
                  className={`w-full rounded-lg px-3 py-2 text-[13px] font-medium text-center ${
                    isDark
                      ? 'bg-white/5 text-white ring-1 ring-white/10'
                      : 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                  }`}
                >
                  Plan activo
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => upgrade(plan.key)}
                  disabled={!!loading}
                  aria-label={`Contratar plan ${plan.name}`}
                  className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
                    isDark
                      ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white hover:from-indigo-400 hover:to-violet-400 shadow-lg hover:shadow-indigo-500/30'
                      : isPopular
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-500 hover:to-indigo-500 shadow-md hover:shadow-blue-500/30'
                        : 'bg-zinc-900 text-white hover:bg-zinc-800'
                  }`}
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  {isLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      Elegir {plan.name}
                      <Sparkles className="w-3 h-3 opacity-80" />
                    </>
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Secondary actions */}
      <div className="stagger-item flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-zinc-100">
        <p className="text-[11px] text-zinc-500">
          Descarga facturas o administra tu método de pago.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <Link href="/settings/invoices">
            <Button
              variant="outline"
              size="sm"
              className="inline-flex items-center gap-2 text-[13px] h-8"
            >
              <FileText className="w-3.5 h-3.5" />
              Facturas
            </Button>
          </Link>

          {!isTrialing && (
            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-2 text-[13px] h-8 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                  Cancelar suscripción
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancelar suscripción</DialogTitle>
                  <DialogDescription>
                    Al cancelar tu suscripción, perderás acceso a las funciones de tu plan al
                    finalizar el periodo de facturación actual. Esta acción no se puede deshacer.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCancelOpen(false)}>
                    Conservar plan
                  </Button>
                  <Button variant="destructive" onClick={handleCancel} disabled={cancelling}>
                    {cancelling ? 'Cancelando...' : 'Sí, cancelar'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </div>
  );
}
