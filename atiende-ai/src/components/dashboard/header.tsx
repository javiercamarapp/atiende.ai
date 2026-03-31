'use client';
import { Bell, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

export function DashHeader({ tenant }: { tenant: any }) {
  const router = useRouter();
  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };
  return (
    <header className="h-14 bg-white border-b flex items-center justify-between px-6">
      <div>
        <h2 className="font-semibold text-gray-800">{tenant.name}</h2>
        <p className="text-xs text-gray-400">
          {tenant.status === 'active' ? '🟢 Agente activo' : '🟡 ' + tenant.status}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon"><Bell className="w-4 h-4" /></Button>
        <Button variant="ghost" size="icon" onClick={handleLogout}><LogOut className="w-4 h-4" /></Button>
      </div>
    </header>
  );
}
