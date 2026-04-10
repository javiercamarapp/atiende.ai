'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, MessageSquare, Calendar, ShoppingBag, Users,
  Phone, Bot, BookOpen, BarChart3, Settings, Shield, Menu,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  conversations: MessageSquare,
  appointments: Calendar,
  orders: ShoppingBag,
  leads: Users,
  calls: Phone,
  agents: Bot,
  knowledge: BookOpen,
  analytics: BarChart3,
  insurance: Shield,
  settings: Settings,
};

const LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  conversations: 'WhatsApp',
  appointments: 'Citas',
  orders: 'Pedidos',
  leads: 'Leads',
  calls: 'Llamadas',
  agents: 'Marketplace',
  knowledge: 'Conocimiento',
  analytics: 'Analytics',
  insurance: 'Seguros',
  settings: 'Configuracion',
};

function SidebarContent({
  tenant,
  modules,
  path,
  onNavigate,
}: {
  tenant: { name: string; plan: string; has_chat_agent?: boolean; has_voice_agent?: boolean };
  modules: string[];
  path: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo + business name */}
      <div className="px-5 pt-6 pb-4">
        <Image
          src="/Add a heading.png"
          alt="atiende.ai"
          width={240}
          height={64}
          className="h-14 w-auto"
          priority
        />
        <p className="text-[11px] text-zinc-400 mt-2 truncate tracking-wide">
          {tenant.name}
        </p>
      </div>

      {/* Separator */}
      <div className="mx-5 h-px bg-zinc-100" />

      {/* Navigation */}
      <nav className="flex-1 px-3 pt-4 pb-2 space-y-0.5 overflow-y-auto">
        {modules.map((mod) => {
          const Icon = ICONS[mod] || LayoutDashboard;
          const href =
            mod === 'dashboard'
              ? '/home'
              : mod === 'settings'
                ? '/settings/agent'
                : '/' + mod;
          const active =
            mod === 'dashboard'
              ? path === '/home'
              : path.startsWith('/' + mod);

          return (
            <Link
              key={mod}
              href={href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150',
                active
                  ? 'bg-zinc-900 text-white shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100/80',
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {LABELS[mod] || mod}
            </Link>
          );
        })}
      </nav>

      {/* Plan badge */}
      <div className="px-4 pb-5 pt-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 border border-zinc-100">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
          <span className="text-[11px] text-zinc-400 font-medium uppercase tracking-widest">
            {tenant.plan === 'free_trial' ? 'Trial' : tenant.plan}
          </span>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({
  tenant,
  modules,
}: {
  tenant: { name: string; plan: string; has_chat_agent?: boolean; has_voice_agent?: boolean };
  modules: string[];
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 glass border-r border-zinc-200/60 flex-col">
        <SidebarContent tenant={tenant} modules={modules} path={path} />
      </aside>

      {/* Mobile hamburger */}
      <div className="fixed top-3 left-3 z-50 md:hidden">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setOpen(true)}
          className="bg-white/80 backdrop-blur-md shadow-lg border-zinc-200/60"
        >
          <Menu className="w-5 h-5 text-zinc-900" />
        </Button>
      </div>

      {/* Mobile sheet */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-0 w-60 flex flex-col bg-white/95 backdrop-blur-xl">
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
