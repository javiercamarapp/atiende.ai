'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, MessageSquare, Calendar, ShoppingBag, Users, Phone, Bot,
  BookOpen, BarChart3, Settings, TrendingUp, Menu, Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, conversations: MessageSquare, appointments: Calendar,
  orders: ShoppingBag, leads: Users, calls: Phone, agents: Bot,
  knowledge: BookOpen, analytics: BarChart3, insurance: Shield, settings: Settings,
};
const LABELS: Record<string, string> = {
  dashboard: 'Dashboard', conversations: 'Conversaciones', appointments: 'Citas',
  orders: 'Pedidos', leads: 'Leads', calls: 'Llamadas', agents: 'Agents',
  knowledge: 'Conocimiento', analytics: 'Analytics', insurance: 'Seguros', settings: 'Ajustes',
};

type TenantShape = {
  name?: string | null;
  plan?: string | null;
  has_chat_agent?: boolean | null;
  has_voice_agent?: boolean | null;
};

function SidebarContent({
  tenant, modules, path, onNavigate,
}: {
  tenant: TenantShape;
  modules: string[];
  path: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      {/* Brand */}
      <div className="px-5 pt-6 pb-5 border-b border-white/5">
        <h1 className="font-semibold text-lg tracking-tight text-white">atiende<span className="text-white/40">.ai</span></h1>
        <p className="text-xs text-white/50 truncate mt-0.5">{tenant.name}</p>
      </div>

      {/* ROI pill */}
      <div className="mx-4 mt-4 glass-card px-3 py-2.5">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[11px] font-medium tracking-wide text-white/70 uppercase">
            ROI este mes
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pt-3 pb-3 space-y-0.5 overflow-y-auto">
        {modules.map((mod) => {
          const Icon = ICONS[mod] || LayoutDashboard;
          const href = mod === 'dashboard' ? '/home' : mod === 'settings' ? '/settings/agent' : '/' + mod;
          const active = mod === 'dashboard' ? path === '/home' : path.startsWith('/' + mod);
          return (
            <Link
              key={mod}
              href={href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] transition-all duration-200',
                active
                  ? 'halo bg-white/[0.06] text-white font-medium'
                  : 'text-white/55 hover:text-white/95 hover:bg-white/[0.035]',
              )}
            >
              {/* Active indicator bar */}
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-full transition-all duration-200',
                  active ? 'h-5 bg-white' : 'h-0 bg-transparent',
                )}
              />
              <Icon
                className={cn(
                  'w-4 h-4 shrink-0 transition-colors',
                  active ? 'text-white' : 'text-white/45 group-hover:text-white/80',
                )}
              />
              <span>{LABELS[mod] || mod}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer — plan + features */}
      <div className="px-4 pb-4 pt-3 border-t border-white/5">
        <div className="glass-card px-3 py-2.5">
          <p className="text-[10.5px] font-medium uppercase tracking-wider text-white/45">
            Plan
          </p>
          <p className="text-sm text-white/90 mt-0.5 capitalize">
            {tenant.plan || 'free trial'}
          </p>
          {(tenant.has_chat_agent || tenant.has_voice_agent) && (
            <div className="flex gap-1.5 mt-2">
              {tenant.has_chat_agent && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/70">
                  Chat
                </span>
              )}
              {tenant.has_voice_agent && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/70">
                  Voz
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export function Sidebar({
  tenant,
  modules,
}: {
  tenant: TenantShape;
  modules: string[];
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-col glass-panel border-r">
        <SidebarContent tenant={tenant} modules={modules} path={path} />
      </aside>

      {/* Mobile hamburger */}
      <div className="fixed top-3 left-3 z-50 md:hidden">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          className="bg-black/60 backdrop-blur border-white/10 text-white hover:bg-white/10 hover:text-white"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* Mobile sheet sidebar */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="p-0 w-64 flex flex-col dashboard-shell glass-panel border-white/10"
        >
          <VisuallyHidden>
            <SheetTitle>Menu de navegacion</SheetTitle>
          </VisuallyHidden>
          <SidebarContent
            tenant={tenant}
            modules={modules}
            path={path}
            onNavigate={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
