'use client';
import { useState, useEffect } from 'react';
import { Bell, LogOut, ChevronRight } from 'lucide-react';
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
    if (percent >= 70) return 'text-yellow-600';
    return 'text-green-600';
  };
  const getProgressClass = () => {
    if (percent > 90) return '[&>div]:bg-red-500';
    if (percent >= 70) return '[&>div]:bg-yellow-500';
    return '[&>div]:bg-green-500';
  };

  return (
    <header className="h-14 bg-white border-b flex items-center justify-between px-6 pl-14 md:pl-6">
      <div>
        <div className="text-sm text-zinc-500 flex items-center">
          <Link href="/home" className="hover:text-zinc-700 transition-colors">Dashboard</Link>
          {!isHome && (
            <>
              <ChevronRight className="w-3 h-3 inline mx-1" />
              <span className="text-zinc-900 font-medium">{currentPage}</span>
            </>
          )}
        </div>
        <p className="text-xs text-gray-400">
          {tenant.status === 'active' ? 'Agente activo' : tenant.status}
        </p>
      </div>
      <div className="flex items-center gap-4">
        {usage !== null && (
          <div className="flex items-center gap-2">
            <Progress value={percent} className={`w-24 h-2 ${getProgressClass()}`} />
            <span className={`text-xs font-medium ${getColor()}`}>
              {usage}/{limit === 999999 ? '∞' : limit} mensajes
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon"><Bell className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" onClick={handleLogout}><LogOut className="w-4 h-4" /></Button>
        </div>
      </div>
    </header>
  );
}
