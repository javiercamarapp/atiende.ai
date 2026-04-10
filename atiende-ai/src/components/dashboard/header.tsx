'use client';
import { useState, useEffect } from 'react';
import { LogOut } from 'lucide-react';
import { NotificationCenter } from '@/components/dashboard/notification-center';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { useRouter, usePathname } from 'next/navigation';
import { getPlanLimit } from '@/lib/analytics/roi';

const PAGE_NAMES: Record<string, string> = {
  '/': 'Dashboard',
  '/home': 'Dashboard',
  '/conversations': 'WhatsApp',
  '/appointments': 'Citas',
  '/orders': 'Pedidos',
  '/leads': 'Leads',
  '/calls': 'Llamadas',
  '/agents': 'Marketplace',
  '/knowledge': 'Conocimiento',
  '/analytics': 'Analytics',
  '/settings': 'Configuracion',
  '/playground': 'Playground',
  '/webhooks': 'Webhooks',
};

interface TenantHeader {
  id: string;
  plan: string;
  status: string;
}

export function DashHeader({ tenant }: { tenant: TenantHeader }) {
  const router = useRouter();
  const pathname = usePathname();
  const [usage, setUsage] = useState<number | null>(null);
  const limit = getPlanLimit(tenant.plan);

  const currentPage =
    PAGE_NAMES[pathname] ||
    PAGE_NAMES['/' + pathname.split('/')[1]] ||
    pathname.split('/').pop() ||
    'Dashboard';
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
        // Best-effort
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

  return (
    <header className="h-14 bg-white/80 backdrop-blur-md border-b border-zinc-200/60 flex items-center justify-between px-6 pl-14 md:pl-6">
      {/* Page title + status */}
      <div>
        <p className="text-sm font-medium text-zinc-900">{currentPage}</p>
        <p className="text-[11px] text-zinc-400 tracking-wide">
          {tenant.status === 'active' ? 'Agente activo' : tenant.status}
        </p>
      </div>

      {/* Right side — usage + actions */}
      <div className="flex items-center gap-4">
        {usage !== null && (
          <div className="flex items-center gap-2.5">
            {/* Thin monochrome bar */}
            <div className="w-20 h-1 bg-zinc-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-zinc-900 rounded-full transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-[11px] text-zinc-400 font-medium tabular-nums">
              {usage}/{limit === 999999 ? '\u221E' : limit}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <NotificationCenter tenantId={tenant.id} />
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            className="text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
