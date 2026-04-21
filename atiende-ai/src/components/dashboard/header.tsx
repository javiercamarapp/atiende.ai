'use client';
import { useState } from 'react';
import { Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NotificationCenter } from '@/components/dashboard/notification-center';

const PAGE_NAMES: Record<string, string> = {
  '/home': 'Dashboard',
  '/conversations': 'Conversaciones',
  '/appointments': 'Citas',
  '/calendar': 'Calendario',
  '/contacts': 'Pacientes',
  '/agents': 'Agents',
  '/knowledge': 'Conocimiento',
  '/chat-data': 'Personal AI',
  '/marketing': 'Marketing AI Content',
  '/analytics': 'Analytics',
  '/settings': 'Ajustes',
  '/playground': 'Playground',
  '/webhooks': 'Webhooks',
};

interface TenantHeader {
  id: string;
  name?: string | null;
  plan: string;
  status: string;
}

interface UserHeader {
  email?: string | null;
  name?: string | null;
}

function initialsFrom(source: string): string {
  const parts = source.trim().split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  const a = parts[0][0] || '';
  const b = parts[1]?.[0] || '';
  return (a + b).toUpperCase() || 'U';
}

export function DashHeader({ tenant, user }: { tenant: TenantHeader; user?: UserHeader }) {
  const pathname = usePathname();
  const [q, setQ] = useState('');

  const seg = '/' + (pathname.split('/')[1] || 'home');
  const title = PAGE_NAMES[seg] || 'Dashboard';

  const displayName = user?.name || tenant.name || user?.email?.split('@')[0] || 'Usuario';
  const initials = initialsFrom(displayName);
  const role = tenant.plan === 'free_trial' ? 'Free trial' : (tenant.plan || 'Admin');

  return (
    <header className="h-16 flex items-center justify-between gap-4 px-4 md:px-8 bg-white">
      {/* Left: Page title */}
      <div className="min-w-0">
        <h1 className="text-[18px] md:text-[24px] font-semibold tracking-tight text-zinc-900 truncate">
          {title}
        </h1>
      </div>

      {/* Right: Search + user + actions */}
      <div className="flex items-center gap-3 md:gap-4">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search anything"
            className="w-64 lg:w-80 pl-10 pr-4 h-10 text-sm rounded-full bg-zinc-50 border border-zinc-200 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
          />
        </div>

        {/* User profile */}
        <div className="hidden sm:flex items-center gap-2.5 pr-1">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[hsl(var(--brand-blue))] to-[hsl(235_84%_68%)] text-white flex items-center justify-center text-xs font-semibold shadow-sm">
            {initials}
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-zinc-900 truncate max-w-[140px]">{displayName}</p>
            <p className="text-[11px] text-zinc-500 capitalize truncate">{role}</p>
          </div>
        </div>

        {/* Bell */}
        <div className="relative">
          <NotificationCenter tenantId={tenant.id} />
        </div>

        {/* Settings gear */}
        <Link
          href="/settings"
          aria-label="Ajustes"
          className="inline-flex w-10 h-10 items-center justify-center rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] hover:opacity-80 transition shadow-sm"
        >
          <Settings className="w-4 h-4" />
        </Link>
      </div>
    </header>
  );
}
