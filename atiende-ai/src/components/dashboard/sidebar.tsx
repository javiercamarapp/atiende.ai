'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, MessageSquare, Calendar, Bot,
  BookOpen, BarChart3, Settings, TrendingUp, Menu, UserCircle2,
  Sparkles, Megaphone,
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, conversations: MessageSquare, appointments: Calendar,
  contacts: UserCircle2, agents: Bot, knowledge: BookOpen, 'chat-data': Sparkles,
  marketing: Megaphone, analytics: BarChart3, settings: Settings,
};
const LABELS: Record<string, string> = {
  dashboard: 'Dashboard', conversations: 'Conversaciones', appointments: 'Citas',
  contacts: 'Pacientes', agents: 'Agents', knowledge: 'Conocimiento',
  'chat-data': 'Pregunta a tus datos', marketing: 'Marketing',
  analytics: 'Analytics', settings: 'Ajustes',
};

type TenantShape = {
  name?: string | null;
  plan?: string | null;
  has_chat_agent?: boolean | null;
  has_voice_agent?: boolean | null;
};

function SidebarContent({
  tenant, modules, path, onNavigate, collapsible = false,
}: {
  tenant: TenantShape;
  modules: string[];
  path: string;
  onNavigate?: () => void;
  collapsible?: boolean;
}) {
  const hideWhenCollapsed = collapsible
    ? 'opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200'
    : '';
  const hideBlockWhenCollapsed = collapsible
    ? 'opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-200 pointer-events-none group-hover/sidebar:pointer-events-auto'
    : '';

  return (
    <>
      <div className="px-4 pt-5 pb-4">
        <Link href="/home" className="block w-fit" onClick={onNavigate}>
          {collapsible ? (
            <>
              {/* Icon only — visible when collapsed */}
              <Image
                src="/logo-icon.png"
                alt="atiende.ai"
                width={80}
                height={80}
                priority
                style={{ height: '36px', width: '36px' }}
                className="shrink-0 block group-hover/sidebar:hidden"
              />
              {/* Full logo — visible when expanded */}
              <Image
                src="/logo.png"
                alt="atiende.ai"
                width={472}
                height={200}
                priority
                style={{ height: '36px', width: 'auto' }}
                className="shrink-0 hidden group-hover/sidebar:block"
              />
            </>
          ) : (
            <Image
              src="/logo.png"
              alt="atiende.ai"
              width={472}
              height={200}
              priority
              style={{ height: '36px', width: 'auto' }}
              className="shrink-0"
            />
          )}
        </Link>
        <p className={cn('text-xs text-zinc-500 truncate mt-2 whitespace-nowrap', hideWhenCollapsed)}>
          {tenant.name}
        </p>
      </div>

      {/* ROI pill */}
      <div className={cn('mx-4 mt-2 glass-card px-3 py-2.5', hideBlockWhenCollapsed)}>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="text-[11px] font-medium tracking-wide text-zinc-600 uppercase">
            ROI este mes
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pt-3 pb-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
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
              title={LABELS[mod] || mod}
              className={cn(
                'relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13.5px] transition-all duration-200 whitespace-nowrap',
                active
                  ? 'halo bg-[hsl(var(--brand-blue-soft))] font-medium'
                  : 'hover:bg-[hsl(var(--brand-blue-soft))]',
              )}
            >
              {/* Active indicator bar */}
              <span
                aria-hidden
                className={cn(
                  'absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-full transition-all duration-200',
                  active ? 'h-5 bg-[hsl(var(--brand-blue))]' : 'h-0 bg-transparent',
                )}
              />
              <Icon className="w-5 h-5 shrink-0 text-[hsl(var(--brand-blue))]" />
              <span className={cn('text-[hsl(var(--brand-blue))]', hideWhenCollapsed)}>
                {LABELS[mod] || mod}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Footer — plan + features */}
      <div className={cn('px-4 pb-4 pt-3 border-t border-zinc-200', hideBlockWhenCollapsed)}>
        <div className="glass-card px-3 py-2.5">
          <p className="text-[10.5px] font-medium uppercase tracking-wider text-zinc-500 whitespace-nowrap">
            Plan
          </p>
          <p className="text-sm text-zinc-900 mt-0.5 capitalize whitespace-nowrap">
            {tenant.plan || 'free trial'}
          </p>
          {(tenant.has_chat_agent || tenant.has_voice_agent) && (
            <div className="flex gap-1.5 mt-2">
              {tenant.has_chat_agent && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] font-medium">
                  Chat
                </span>
              )}
              {tenant.has_voice_agent && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))] font-medium">
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
      {/* Desktop sidebar — in-flow, content pushes right on expand */}
      <aside className="group/sidebar hidden md:flex w-[72px] hover:w-64 shrink-0 flex-col glass-panel border-r border-zinc-200 overflow-hidden transition-[width] duration-300">
        <SidebarContent tenant={tenant} modules={modules} path={path} collapsible />
      </aside>

      {/* Mobile hamburger */}
      <div className="fixed top-3 left-3 z-50 md:hidden">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          className="bg-white/90 backdrop-blur border-zinc-200 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
        >
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* Mobile sheet sidebar */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className="p-0 w-64 flex flex-col dashboard-shell glass-panel border-zinc-200"
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
