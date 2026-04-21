'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, MessageSquare, Calendar, Sparkles, Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { cn } from '@/lib/utils';
import { SidebarContent } from '@/components/dashboard/sidebar';

interface TenantShape {
  name?: string | null;
  plan?: string | null;
  trial_ends_at?: string | null;
  has_chat_agent?: boolean | null;
  has_voice_agent?: boolean | null;
}

interface Tab {
  key: string;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: Tab[] = [
  { key: 'dashboard', label: 'Inicio', href: '/home', icon: LayoutDashboard },
  { key: 'conversations', label: 'Mensajes', href: '/conversations', icon: MessageSquare },
  { key: 'appointments', label: 'Citas', href: '/appointments', icon: Calendar },
  { key: 'chat-data', label: 'Personal AI', href: '/chat-data', icon: Sparkles },
];

export function BottomTabBar({
  tenant,
  modules,
}: {
  tenant: TenantShape;
  modules: string[];
}) {
  const path = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const visibleTabs = TABS.filter((t) => modules.includes(t.key));

  function isActive(tab: Tab): boolean {
    if (tab.key === 'dashboard') return path === '/home';
    return path.startsWith(tab.href);
  }

  return (
    <>
      <nav
        aria-label="Navegación principal"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-zinc-100 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex items-stretch h-16">
          {visibleTabs.map((tab) => {
            const active = isActive(tab);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 transition',
                  active
                    ? 'text-[hsl(var(--brand-blue))]'
                    : 'text-zinc-500 hover:text-zinc-900',
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-medium tracking-tight">{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 transition',
              moreOpen ? 'text-[hsl(var(--brand-blue))]' : 'text-zinc-500 hover:text-zinc-900',
            )}
          >
            <Menu className="w-5 h-5" strokeWidth={1.5} />
            <span className="text-[10px] font-medium tracking-tight">Más</span>
          </button>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="left"
          className="p-0 w-72 flex flex-col bg-white border-zinc-200"
        >
          <VisuallyHidden>
            <SheetTitle>Menú de navegación</SheetTitle>
          </VisuallyHidden>
          <SidebarContent
            tenant={tenant}
            modules={modules}
            path={path}
            onNavigate={() => setMoreOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
