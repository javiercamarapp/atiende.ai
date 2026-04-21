'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
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
    name: 'Básico',
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
      { icon: Check, text: 'Todo lo del plan Básico' },
      { icon: Sun, text: 'Briefing diario a las 8am con tu agenda' },
      { icon: Mic, text: 'Voice notes a acciones: dicta y la IA ejecuta' },
      { icon: PenTool, text: 'Generación de contenido para Instagram, Facebook y blog' },
      { icon: RefreshCw, text: 'Reactivación automática de pacientes inactivos (+6 meses)' },
      { icon: Send, text: '500 mensajes salientes mensuales para campañas' },
      { icon: TrendingUp, text: 'Reporte semanal con métricas clave' },
      { icon: Download, text: 'Dashboard avanzado con exports a Excel' },
      { icon: Users, text: '3 usuarios administradores con permisos granulares' },
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
      { icon: Clock, text: '300 minutos de voz incluidos mensualmente' },
      { icon: PhoneCall, text: 'Llamadas entrantes y salientes automatizadas' },
      { icon: DollarSign, text: 'Minuto adicional de voz a $5 MXN' },
      { icon: CreditCard, text: 'Links de pago de Clip o Stripe dentro del chat' },
      { icon: Code, text: 'API completa para integraciones custom' },
      { icon: UserPlus, text: 'Usuarios administradores ilimitados' },
      { icon: Rocket, text: 'Onboarding 1:1 con un especialista (2 horas)' },
      { icon: Briefcase, text: 'Account manager dedicado' },
      { icon: Shield, text: 'Alta disponibilidad con monitoreo 24/7' },
      { icon: MessageCircle, text: 'Soporte 24/7 por WhatsApp y llamada' },
    ],
  },
];

function getPlanInfo(key: string): Plan | undefined {
  return PLANS.find((p) => p.key === key);
}

function usageGradient(pct: number): string {
  if (pct >= 90) return 'from-orange-500 to-red-500';
  if (pct >= 71) return 'from-amber-400 to-orange-500';
  return 'from-emerald-400 to-blue-500';
}

export function BillingManager({ tenant }: { tenant: Record<string, unknown> | null }) {
  const [loading, setLoading] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [usage, setUsage] = useState<{ count: number } | null>(null);

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

  const upgrade = async (plan: string) => {
    setLoading(plan);
    try {
      const r = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (!r.ok) throw new Error('Checkout failed');
      const d = await r.json();
      if (d.url) window.location.href = d.url;
    } catch {
      toast.error('Error al procesar el pago');
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

  return (
    <div className="space-y-8">
      {/* Section 1: header */}
      <div className="stagger-item">
        <h2 className="text-lg font-semibold text-zinc-900">Tu suscripción</h2>
        <p className="text-sm text-zinc-500 mt-0.5">
          Administra tu plan, consulta tu uso y descarga tus facturas.
        </p>
      </div>

      {/* Section 2: hero — current plan + usage */}
      <div className="stagger-item glass-card p-6 md:p-8 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 blur-3xl opacity-60 pointer-events-none"
        />
        <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Current plan card */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-gradient-to-br from-blue-50 to-indigo-50 ring-1 ring-blue-100">
                {isTrialing ? (
                  <Sparkles className="w-5 h-5 text-blue-600" />
                ) : currentPlan ? (
                  <currentPlan.tierIcon className="w-5 h-5 text-blue-600" />
                ) : (
                  <Sparkles className="w-5 h-5 text-blue-600" />
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                  Plan actual
                </p>
                <p className="text-xl font-semibold text-zinc-900">
                  {isTrialing ? 'Prueba gratuita' : currentPlan?.name ?? tenantPlan}
                </p>
              </div>
            </div>

            {!isTrialing && currentPlan && (
              <p className="text-sm text-zinc-600">
                <span className="font-medium text-zinc-900">
                  ${currentPlan.price.toLocaleString('es-MX')} MXN
                </span>{' '}
                / mes · {currentPlan.tagline}
              </p>
            )}

            {isTrialing && trialDaysLeft !== null && (
              <div
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
                  trialDaysLeft <= 3
                    ? 'bg-red-50 text-red-700 ring-1 ring-red-100'
                    : 'bg-amber-50 text-amber-800 ring-1 ring-amber-100'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                {trialDaysLeft > 0
                  ? `${trialDaysLeft} día${trialDaysLeft !== 1 ? 's' : ''} restantes de prueba`
                  : 'Tu prueba terminó — elige un plan abajo'}
              </div>
            )}

            {hasCustomer && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <CreditCard className="w-3.5 h-3.5" />
                <span>Método de pago registrado</span>
              </div>
            )}
          </div>

          {/* Usage meter */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-xs uppercase tracking-wide text-zinc-500 font-medium">
                Uso este mes
              </p>
              <p className="text-xs text-zinc-500">
                {usedCount.toLocaleString('es-MX')} / {limit.toLocaleString('es-MX')} mensajes
              </p>
            </div>

            <div className="relative h-3 w-full rounded-full bg-zinc-100 overflow-hidden">
              <div
                className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${usageColor} transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>
                {remaining.toLocaleString('es-MX')}{' '}
                {remaining === 1 ? 'mensaje restante' : 'mensajes restantes'}
              </span>
              <span className="font-medium text-zinc-700">{usagePercent}%</span>
            </div>

            {usagePercent >= 90 && (
              <p className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-100 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                {usagePercent >= 100
                  ? 'Límite alcanzado. Mejora tu plan para seguir respondiendo mensajes.'
                  : 'Estás cerca del límite mensual de tu plan.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Section 3: plan grid */}
      <div>
        <div className="stagger-item mb-4">
          <h3 className="text-lg font-semibold text-zinc-900">Cambia o contrata un plan</h3>
          <p className="text-sm text-zinc-500 mt-0.5">
            Todos los planes son mensuales. Puedes cancelar cuando quieras.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:items-stretch">
          {PLANS.map((plan, idx) => {
            const isCurrent = tenantPlan === plan.key;
            const isLoading = loading === plan.key;
            const isDark = plan.key === 'premium';
            const isPopular = Boolean(plan.popular);
            const TierIcon = plan.tierIcon;

            const baseCard = 'stagger-item relative flex flex-col rounded-[var(--radius)] p-6 transition-all duration-300 hover:-translate-y-1';
            const themeCard = isDark
              ? 'bg-zinc-900 text-white shadow-xl hover:shadow-2xl ring-1 ring-zinc-800'
              : isPopular
                ? 'bg-white shadow-md hover:shadow-xl ring-2 ring-[hsl(235_84%_55%)] lg:scale-[1.02]'
                : 'bg-white shadow-sm hover:shadow-lg ring-1 ring-zinc-200';
            const currentBorder = isCurrent && !isDark && !isPopular ? ' ring-2 ring-[hsl(235_84%_55%)]' : '';

            return (
              <div key={plan.key} className={`${baseCard} ${themeCard}${currentBorder}`}>
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <span className="inline-flex items-center gap-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[11px] font-semibold px-3 py-1 rounded-full shadow-lg tracking-wide">
                      <Sparkles className="w-3 h-3" />
                      Más popular
                    </span>
                  </div>
                )}

                {isCurrent && (
                  <div className="absolute top-3 right-3">
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        isDark
                          ? 'bg-white/10 text-white ring-1 ring-white/20'
                          : 'bg-blue-50 text-blue-700 ring-1 ring-blue-100'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                      Tu plan
                    </span>
                  </div>
                )}

                {/* Header */}
                <div className="flex items-center gap-3 mb-1">
                  <div
                    className={`p-2 rounded-full transition-transform duration-300 group-hover:scale-110 ${
                      isDark
                        ? 'bg-white/10 ring-1 ring-white/10'
                        : isPopular
                          ? 'bg-gradient-to-br from-blue-50 to-indigo-50 ring-1 ring-blue-100'
                          : 'bg-zinc-50 ring-1 ring-zinc-100'
                    }`}
                  >
                    <TierIcon
                      className={`w-5 h-5 ${
                        isDark ? 'text-indigo-300' : isPopular ? 'text-blue-600' : 'text-zinc-700'
                      }`}
                    />
                  </div>
                  <h4 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    {plan.name}
                  </h4>
                </div>

                <p className={`text-xs mb-4 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  {plan.tagline}
                </p>

                {/* Price */}
                <div className="mb-5">
                  <div className="flex items-baseline gap-1">
                    <span className={`text-4xl font-bold tracking-tight ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                      ${plan.price.toLocaleString('es-MX')}
                    </span>
                    <span className={`text-sm ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                      MXN / mes
                    </span>
                  </div>
                  <p className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    {plan.msgLimit.toLocaleString('es-MX')} mensajes incluidos
                  </p>
                </div>

                {/* Features */}
                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((f, i) => {
                    const FeatureIcon = f.icon;
                    return (
                      <li
                        key={`${plan.key}-${i}`}
                        className={`flex items-start gap-2.5 text-sm ${
                          isDark ? 'text-zinc-200' : 'text-zinc-700'
                        }`}
                      >
                        <FeatureIcon
                          className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                            isDark
                              ? 'text-indigo-300'
                              : isPopular
                                ? 'text-blue-600'
                                : 'text-zinc-500'
                          }`}
                        />
                        <span className="leading-snug">{f.text}</span>
                      </li>
                    );
                  })}
                </ul>

                {/* CTA */}
                {isCurrent ? (
                  <div
                    className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium text-center ${
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
                    className={`w-full inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed ${
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
                        <Sparkles className="w-3.5 h-3.5 opacity-80" />
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 4: secondary actions */}
      <div className="stagger-item flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-zinc-100">
        <p className="text-xs text-zinc-500">
          ¿Necesitas ayuda con tu facturación? Descarga tus facturas o administra tu método de pago.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={openPortal}
            disabled={loading === 'portal' || !hasCustomer}
            className="inline-flex items-center gap-2"
          >
            {loading === 'portal' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileText className="w-4 h-4" />
            )}
            {loading === 'portal' ? 'Cargando...' : 'Historial de facturas'}
          </Button>

          {!isTrialing && (
            <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="inline-flex items-center gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                >
                  Cancelar suscripción
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Cancelar suscripción</DialogTitle>
                  <DialogDescription>
                    Al cancelar tu suscripción, perderás acceso a las funciones de tu plan al finalizar el
                    periodo de facturación actual. Esta acción no se puede deshacer.
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
