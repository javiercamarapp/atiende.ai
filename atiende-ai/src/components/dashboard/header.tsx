'use client';
import { useState, useEffect } from 'react';
import { Bell, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { getPlanLimit } from '@/lib/analytics/roi';

export function DashHeader({ tenant }: { tenant: any }) {
  const router = useRouter();
  const [usage, setUsage] = useState<number | null>(null);
  const limit = getPlanLimit(tenant.plan);

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
    <header className="h-14 bg-white border-b flex items-center justify-between px-6">
      <div>
        <h2 className="font-semibold text-gray-800">{tenant.name}</h2>
        <p className="text-xs text-gray-400">
          {tenant.status === 'active' ? '🟢 Agente activo' : '🟡 ' + tenant.status}
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
