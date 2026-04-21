'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, MessageSquare, Calendar, CalendarDays, Bot,
  BookOpen, BarChart3, Settings, TrendingUp, Menu, UserCircle2,
  Sparkles, Megaphone, HelpCircle,
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, conversations: MessageSquare, appointments: Calendar,
  calendar: CalendarDays, contacts: UserCircle2, agents: Bot, knowledge: BookOpen,
  'chat-data': Sparkles, marketing: Megaphone, analytics: BarChart3, settings: Settings,
};
const LABELS: Record<string, string> = {
  dashboard: 'Dashboard', conversations: 'Conversaciones', appointments: 'Citas',
  calendar: 'Calendario', contacts: 'Pacientes', agents: 'Agents',
  knowledge: 'Conocimiento', 'chat-data': 'Pregunta a tus datos',
  marketing: 'Marketing', analytics: 'Analytics', settings: 'Ajustes',
};

const TOP_GROUP = new Set(['dashboard', 'appointments', 'calendar', 'conversations', 'contacts', 'agents']);

type TenantShape = {
  name?: string | null;
  plan?: string | null;
  has_chat_agent?: boolean | null;
  has_voice_agent?: boolean | null;
};

function NavLink({
  href, label, icon: Icon, active, collapsible, onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsible: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={cn(
        'relative flex items-center py-2.5 rounded-lg text-[13.5px] transition-all duration-200 whitespace-nowrap',
        collapsible
          ? 'justify-center group-hover/sidebar:justify-start group-hover/sidebar:gap-3 group-hover/sidebar:px-3'
          : 'gap-3 px-3',
        active
          ? 'halo bg-[hsl(var(--brand-blue-soft))] font-medium'
          : 'hover:bg-[hsl(var(--brand-blue-soft))]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1/2 -translate-y-1/2 w-0.5 rounded-full transition-all duration-200',
          active ? 'h-5 bg-[hsl(var(--brand-blue))]' : 'h-0 bg-transparent',
        )}
      />
      <Icon className="w-5 h-5 shrink-0 text-[hsl(var(--brand-blue))]" />
      <span className={cn(
        'text-[hsl(var(--brand-blue))]',
        collapsible && 'hidden group-hover/sidebar:inline',
      )}>
        {label}
      </span>
    </Link>
  );
}

function SidebarContent({
  tenant, modules, path, onNavigate, collapsible = false,
}: {
  tenant: TenantShape;
  modules: string[];
  path: string;
  onNavigate?: () => void;
  collapsible?: boolean;
}) {
  const navModules = modules.filter(m => m !== 'settings');
  const primaryMods = navModules.filter(m => TOP_GROUP.has(m));
  const secondaryMods = navModules.filter(m => !TOP_GROUP.has(m));

  function getHref(mod: string) {
    if (mod === 'dashboard') return '/home';
    if (mod === 'settings') return '/settings/agent';
    return '/' + mod;
  }
  function isActive(mod: string) {
    if (mod === 'dashboard') return path === '/home';
    return path.startsWith('/' + mod);
  }

  return (
    <>
      {/* Logo */}
      <div className={cn(
        'px-4 pt-5 pb-4',
        collapsible && 'flex flex-col items-center group-hover/sidebar:items-start',
      )}>
        <Link href="/home" className="block w-fit" onClick={onNavigate}>
          {collapsible ? (
            <>
              <Image
                src="/logo-icon.png" alt="atiende.ai" width={80} height={80} priority
                style={{ height: '36px', width: '36px' }}
                className="shrink-0 block group-hover/sidebar:hidden"
              />
              <Image
                src="/logo.png" alt="atiende.ai" width={472} height={200} priority
                style={{ height: '36px', width: 'auto' }}
                className="shrink-0 hidden group-hover/sidebar:block"
              />
            </>
          ) : (
            <Image
              src="/logo.png" alt="atiende.ai" width={472} height={200} priority
              style={{ height: '36px', width: 'auto' }}
              className="shrink-0"
            />
          )}
        </Link>
        <p className={cn(
          'text-xs text-zinc-500 truncate mt-2 whitespace-nowrap',
          collapsible && 'hidden group-hover/sidebar:block',
        )}>
          {tenant.name}
        </p>
      </div>

      {/* ROI pill — only when expanded */}
      <div className={cn(
        'mx-4 mt-2 glass-card px-3 py-2.5',
        collapsible && 'hidden group-hover/sidebar:block',
      )}>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="text-[11px] font-medium tracking-wide text-zinc-600 uppercase">
            ROI este mes
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 pt-3 pb-3 overflow-y-auto overflow-x-hidden">
        <div className="space-y-0.5">
          {primaryMods.map(mod => (
            <NavLink
              key={mod} href={getHref(mod)} label={LABELS[mod] || mod}
              icon={ICONS[mod] || LayoutDashboard} active={isActive(mod)}
              collapsible={collapsible} onNavigate={onNavigate}
            />
          ))}
        </div>
        {secondaryMods.length > 0 && (
          <>
            <div className={cn(
              'my-2 border-t border-zinc-200',
              collapsible && 'mx-2 group-hover/sidebar:mx-0',
            )} />
            <div className="space-y-0.5">
              {secondaryMods.map(mod => (
                <NavLink
                  key={mod} href={getHref(mod)} label={LABELS[mod] || mod}
                  icon={ICONS[mod] || LayoutDashboard} active={isActive(mod)}
                  collapsible={collapsible} onNavigate={onNavigate}
                />
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Bottom — settings + help */}
      <div className="px-3 pb-3 border-t border-zinc-200 pt-2 space-y-0.5">
        {modules.includes('settings') && (
          <NavLink
            href="/settings/agent" label="Ajustes" icon={Settings}
            active={path.startsWith('/settings')} collapsible={collapsible}
            onNavigate={onNavigate}
          />
        )}
        <NavLink
          href="https://wa.me/5215512345678" label="Ayuda" icon={HelpCircle}
          active={false} collapsible={collapsible}
          onNavigate={onNavigate}
        />
      </div>

      {/* Plan card — only when expanded */}
      <div className={cn(
        'px-4 pb-4 pt-3 border-t border-zinc-200',
        collapsible && 'hidden group-hover/sidebar:block',
      )}>
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
      {/* Desktop sidebar */}
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
