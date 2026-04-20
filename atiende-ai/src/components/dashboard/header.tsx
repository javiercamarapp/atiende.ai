'use client';
import { useState, useEffect } from 'react';
import { LogOut, ChevronRight } from 'lucide-react';
import { NotificationCenter } from '@/components/dashboard/notification-center';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { createClient } from '@/lib/supabase/client';
import { useRouter, usePathname } from 'next/navigation';
import { getPlanLimit } from '@/lib/analytics/roi';
import Link from 'next/link';

const PAGE_NAMES: Record<string, string> = {
  '/': 'Dashboard',
  '/home': 'Dashboard',
  '/conversations': 'Conversaciones',
  '/appointments': 'Citas',
  '/orders': 'Pedidos',
  '/leads': 'Leads',
  '/calls': 'Llamadas',
  '/agents': 'Agents Marketplace',
  '/knowledge': 'Base Conocimiento',
  '/analytics': 'Analytics',
  '/settings': 'Configuracion',
  '/playground': 'Playground',
  '/webhooks': 'Webhooks',
};

interface TenantHeader { id: string; plan: string; status: string; }
export function DashHeader({ tenant }: { tenant: TenantHeader }) {
  const router = useRouter();
  const pathname = usePathname();
  const [usage, setUsage] = useState<number | null>(null);
  const limit = getPlanLimit(tenant.plan);

  const currentPage = PAGE_NAMES[pathname] || PAGE_NAMES['/' + pathname.split('/')[1]] || pathname.split('/').pop() || 'Dashboard';
  const isHome = pathname === '/' || pathname === '/home';

  useEffect(() => {
    async function fetchUsage() {
      try {
        const res = await fetch(`/api/usage?tenantId=${tenant.id}`);
        if (res.ok) {
          const data = await res.json();
          setUsage(data.count);
        }
      } catch {
        // Usage fetch is best-effort
      }
    }
    fetchUsage();
  }, [tenant.id]);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const percent = usage !== null ? Math.min((usage / limit) * 100, 100) : 0;
  const getColor = () => {
    if (percent > 90) return 'text-red-600';
    if (percent >= 70) return 'text-amber-600';
    return 'text-emerald-600';
  };
  const getProgressClass = () => {
    if (percent > 90) return '[&>div]:bg-red-500';
    if (percent >= 70) return '[&>div]:bg-amber-500';
    return '[&>div]:bg-emerald-500';
  };

  return (
    <header className="h-14 bg-white/90 backdrop-blur flex items-center justify-between px-6 pl-14 md:pl-6">
      <div>
        <div className="text-sm flex items-center">
          <Link
            href="/home"
            className="text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            Dashboard
          </Link>
          {!isHome && (
            <>
              <ChevronRight className="w-3 h-3 inline mx-1.5 text-zinc-400" />
              <span className="text-zinc-900 font-medium">{currentPage}</span>
            </>
          )}
        </div>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          {tenant.status === 'active' ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Agente activo
            </span>
          ) : (
            tenant.status
          )}
        </p>
      </div>
      <div className="flex items-center gap-4">
        {usage !== null && (
          <div className="hidden sm:flex items-center gap-2">
            <Progress
              value={percent}
              className={`w-24 h-1.5 bg-zinc-100 ${getProgressClass()}`}
            />
            <span className={`text-xs font-medium tabular-nums ${getColor()}`}>
              {usage}/{limit === 999999 ? '∞' : limit}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <NotificationCenter tenantId={tenant.id} />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            className="text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
