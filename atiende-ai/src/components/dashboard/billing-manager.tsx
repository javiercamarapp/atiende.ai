'use client';
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from '@/components/ui/dialog';
import { CreditCard, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Plan {
  key: string;
  name: string;
  price: number;
  msgLimit: number;
  msgs: string;
  features: string[];
}

const PLANS: Plan[] = [
  {
    key: 'basic',
    name: 'Basico',
    price: 599,
    msgLimit: 500,
    msgs: '500 msgs/mes',
    features: ['Chatbot WhatsApp', 'Base de conocimiento', 'Dashboard basico'],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 999,
    msgLimit: 2000,
    msgs: '2,000 msgs/mes',
    features: ['Todo en Basico', 'RAG avanzado', 'Reportes', 'API access'],
  },
  {
    key: 'premium',
    name: 'Premium',
    price: 1499,
    msgLimit: 10000,
    msgs: 'Ilimitado + Voz',
    features: ['Todo en Pro', 'Agente de voz', 'Prioridad soporte', 'Multi-agente'],
  },
];

function getPlanLimit(plan: string): number {
  const found = PLANS.find((p) => p.key === plan);
  return found?.msgLimit ?? 50;
}

export function BillingManager({ tenant }: { tenant: Record<string, unknown> | null }) {
  const [loading, setLoading] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [usage, setUsage] = useState<{ count: number } | null>(null);

  const tenantPlan = (tenant?.plan as string) || 'free_trial';
  const tenantId = tenant?.id as string;

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

  const limit = getPlanLimit(tenantPlan);
  const usedCount = usage?.count ?? 0;
  const usagePercent = limit > 0 ? Math.min(100, Math.round((usedCount / limit) * 100)) : 0;

  const currentPlanInfo = PLANS.find((p) => p.key === tenantPlan);

  return (
    <div className="space-y-6">
      {/* Current plan + features */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Plan actual</p>
              <Badge className="text-lg px-3 py-1 mt-1">
                {tenantPlan === 'free_trial' ? 'Prueba gratuita' : (currentPlanInfo?.name || tenantPlan)}
              </Badge>
            </div>
            {Boolean(tenant?.stripe_customer_id as string) && (
              <div className="flex items-center gap-1 text-sm text-gray-500">
                <CreditCard className="w-4 h-4" />
                <span>Metodo de pago registrado</span>
              </div>
            )}
          </div>

          {Boolean(tenant?.trial_ends_at as string) && (
            <p className="text-sm text-gray-500">
              Prueba hasta: {new Date(tenant!.trial_ends_at as string).toLocaleDateString('es-MX')}
            </p>
          )}

          {currentPlanInfo && (
            <div>
              <p className="text-sm font-medium text-gray-700 mb-1">Incluye:</p>
              <ul className="text-sm text-gray-500 space-y-0.5">
                {currentPlanInfo.features.map((f) => (
                  <li key={f}>- {f}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Usage this month */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Uso este mes</p>
            <p className="text-sm text-gray-500">
              {usedCount.toLocaleString()} / {limit.toLocaleString()} mensajes
            </p>
          </div>
          <Progress value={usagePercent} />
          {usagePercent >= 90 && (
            <p className="text-xs text-amber-600 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              {usagePercent >= 100
                ? 'Limite de mensajes alcanzado. Mejora tu plan para continuar.'
                : 'Estas cerca del limite de mensajes de tu plan.'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Plan cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((p) => (
          <Card
            key={p.key}
            className={tenantPlan === p.key ? 'border-blue-500 bg-blue-50' : ''}
          >
            <CardContent className="pt-6">
              <h3 className="font-bold text-lg">{p.name}</h3>
              <p className="text-2xl font-bold mt-1">
                ${p.price}
                <span className="text-sm text-gray-500"> MXN/mes</span>
              </p>
              <p className="text-xs text-gray-500 mt-1">{p.msgs}</p>
              <ul className="text-xs text-gray-500 mt-2 space-y-0.5">
                {p.features.map((f) => (
                  <li key={f}>- {f}</li>
                ))}
              </ul>
              {tenantPlan !== p.key && (
                <Button
                  className="w-full mt-4"
                  size="sm"
                  onClick={() => upgrade(p.key)}
                  disabled={!!loading}
                >
                  {loading === p.key && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Contratar
                </Button>
              )}
              {tenantPlan === p.key && (
                <p className="mt-4 text-sm text-blue-600 font-medium text-center">
                  Plan actual
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Invoice history + cancel */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Button variant="outline" onClick={openPortal} disabled={loading === 'portal'}>
          <FileText className="w-4 h-4 mr-2" />
          {loading === 'portal' ? 'Cargando...' : 'Historial de facturas'}
        </Button>

        {tenantPlan !== 'free_trial' && (
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50">
                Cancelar suscripcion
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Cancelar suscripcion</DialogTitle>
                <DialogDescription>
                  Al cancelar tu suscripcion, perderas acceso a las funciones de tu plan al
                  finalizar el periodo de facturacion actual. Esta accion no se puede deshacer.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCancelOpen(false)}>
                  Conservar plan
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? 'Cancelando...' : 'Si, cancelar'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </div>
  );
}
