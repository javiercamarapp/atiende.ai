'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, MessageSquare, Calendar, CalendarDays, Bot,
  BookOpen, BarChart3, Settings, Menu, UserCircle2,
  Sparkles, Megaphone, LogOut, Crown, TrendingUp,
} from 'lucide-react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { createClient } from '@/lib/supabase/client';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, appointments: Calendar, calendar: CalendarDays,
  conversations: MessageSquare, contacts: UserCircle2, agents: Bot,
  knowledge: BookOpen, 'chat-data': Sparkles, marketing: Megaphone,
  analytics: BarChart3, settings: Settings,
};
const LABELS: Record<string, string> = {
  dashboard: 'Dashboard', appointments: 'Citas', calendar: 'Calendario',
  conversations: 'Conversaciones', contacts: 'Pacientes', agents: 'Agents',
  knowledge: 'Conocimiento', 'chat-data': 'Pregunta a tus datos',
  marketing: 'Marketing', analytics: 'Analytics', settings: 'Ajustes',
};

/** Final sidebar order — Dashboard + Citas + Calendario + Conversaciones + Pacientes,
 *  then the redesigned modules (Agents, Conocimiento, Pregunta, Marketing, Analytics). */
const ORDER = [
  'dashboard',
  'appointments',
  'calendar',
  'conversations',
  'contacts',
  'agents',
  'knowledge',
  'chat-data',
  'marketing',
  'analytics',
];

type TenantShape = {
  name?: string | null;
  plan?: string | null;
  trial_ends_at?: string | null;
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
        'relative flex items-center h-10 rounded-lg text-[13.5px] transition-all duration-200 whitespace-nowrap',
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
  const router = useRouter();
  const navModules = ORDER.filter(m => modules.includes(m));

  function getHref(mod: string) {
    if (mod === 'dashboard') return '/home';
    return '/' + mod;
  }
  function isActive(mod: string) {
    if (mod === 'dashboard') return path === '/home';
    return path.startsWith('/' + mod);
  }

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const isFreeTrial = tenant.plan === 'free_trial' || !tenant.plan;
  const daysLeft = tenant.trial_ends_at
    ? Math.max(
        0,
        Math.ceil(
          // eslint-disable-next-line react-hooks/purity
          (new Date(tenant.trial_ends_at).getTime() - Date.now()) / 86_400_000,
        ),
      )
    : null;

  return (
    <>
      {/* Logo — fixed height so nav never shifts when expanding */}
      <div className="h-[68px] px-4 pt-5 pb-4 flex items-center">
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
      </div>

      {/* Nav — always at top, icons never shift vertically on hover */}
      <nav className="flex-1 px-3 pt-1 pb-2 overflow-y-auto overflow-x-hidden">
        <div className="space-y-0.5">
          {navModules.map(mod => (
            <NavLink
              key={mod} href={getHref(mod)} label={LABELS[mod] || mod}
              icon={ICONS[mod] || LayoutDashboard} active={isActive(mod)}
              collapsible={collapsible} onNavigate={onNavigate}
            />
          ))}
        </div>
      </nav>

      {/* ROI pill — right above the plan card (only when expanded) */}
      <div className={cn(
        'px-4 pt-2',
        collapsible && 'hidden group-hover/sidebar:block',
      )}>
        <div className="rounded-xl bg-white border border-zinc-200 px-3 py-2 flex items-center gap-2 whitespace-nowrap">
          <TrendingUp className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="text-[11px] font-medium tracking-wide text-zinc-600 uppercase">
            ROI este mes
          </span>
        </div>
      </div>

      {/* Free trial / Upgrade card — only when expanded */}
      <div className={cn(
        'px-4 pt-2',
        collapsible && 'hidden group-hover/sidebar:block',
      )}>
        <div className="rounded-2xl bg-[hsl(var(--brand-blue-soft))] p-4 text-center">
          <div className="w-10 h-10 mx-auto rounded-full bg-white flex items-center justify-center shadow-sm">
            <Crown className="w-5 h-5 text-[hsl(var(--brand-blue))]" />
          </div>
          <p className="mt-2.5 text-[13px] font-semibold text-zinc-900">
            {isFreeTrial ? 'Free trial' : 'Upgrade to Pro'}
          </p>
          <p className="text-[11px] text-zinc-600 mt-1 leading-snug">
            {isFreeTrial && daysLeft !== null
              ? `Te quedan ${daysLeft} día${daysLeft !== 1 ? 's' : ''} de prueba.`
              : 'Desbloquea todas las funciones premium.'}
          </p>
          <Link
            href="/settings/billing"
            onClick={onNavigate}
            className="mt-2.5 inline-flex w-full items-center justify-center rounded-full bg-[hsl(var(--brand-blue))] text-white text-[11.5px] font-medium px-3 py-1.5 hover:opacity-90 transition"
          >
            {isFreeTrial ? 'Ver planes' : 'Upgrade Now'}
          </Link>
        </div>
      </div>

      {/* Sign Out — always visible, below the trial card */}
      <div className="px-3 py-3">
        <button
          onClick={handleLogout}
          title="Sign Out"
          className={cn(
            'w-full flex items-center h-10 rounded-lg text-[13.5px] text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 transition',
            collapsible
              ? 'justify-center group-hover/sidebar:justify-start group-hover/sidebar:gap-3 group-hover/sidebar:px-3'
              : 'gap-3 px-3',
          )}
        >
          <LogOut className="w-5 h-5 shrink-0" />
          <span className={cn(collapsible && 'hidden group-hover/sidebar:inline')}>
            Sign Out
          </span>
        </button>
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
      <aside className="group/sidebar hidden md:flex w-[72px] hover:w-64 shrink-0 flex-col overflow-hidden transition-[width] duration-300">
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
