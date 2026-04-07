'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, MessageSquare, Calendar, ShoppingBag, Users, Phone, Bot, BookOpen, BarChart3, Settings, TrendingUp, Menu, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';

const ICONS: Record<string,any> = {
  dashboard:LayoutDashboard, conversations:MessageSquare, appointments:Calendar,
  orders:ShoppingBag, leads:Users, calls:Phone, agents:Bot,
  knowledge:BookOpen, analytics:BarChart3, insurance:Shield, settings:Settings,
};
const LABELS: Record<string,string> = {
  dashboard:'Dashboard', conversations:'Conversaciones', appointments:'Citas',
  orders:'Pedidos', leads:'Leads', calls:'Llamadas', agents:'Agents Marketplace',
  knowledge:'Base Conocimiento', analytics:'Analytics', insurance:'Seguros', settings:'Configuracion',
};

function SidebarContent({ tenant, modules, path, onNavigate }: { tenant:any; modules:string[]; path:string; onNavigate?:()=>void }) {
  return (
    <>
      <div className="p-4 border-b">
        <h1 className="font-bold text-lg text-emerald-600">atiende.ai</h1>
        <p className="text-xs text-gray-500 truncate mt-1">{tenant.name}</p>
      </div>
      <div className="mx-3 mt-3 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-emerald-600" />
          <span className="text-xs font-bold text-emerald-700">ROI este mes</span>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {modules.map(mod => {
          const Icon = ICONS[mod] || LayoutDashboard;
          const href = mod === 'dashboard' ? '/home' : mod === 'settings' ? '/settings/agent' : '/' + mod;
          const active = mod === 'dashboard' ? path === '/home' : path.startsWith('/' + mod);
          return (
            <Link key={mod} href={href} onClick={onNavigate}
              className={cn('flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition',
                active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100')}>
              <Icon className="w-4 h-4" />{LABELS[mod] || mod}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t">
        <div className="bg-gray-50 rounded-lg p-3">
          <p className="text-xs font-medium text-gray-500">Plan: {tenant.plan}</p>
          <p className="text-xs text-gray-400 mt-1">
            {tenant.has_chat_agent && 'Chat '}{tenant.has_voice_agent && 'Voz'}
          </p>
        </div>
      </div>
    </>
  );
}

export function Sidebar({ tenant, modules }: { tenant:any; modules:string[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 bg-white border-r flex-col">
        <SidebarContent tenant={tenant} modules={modules} path={path} />
      </aside>

      {/* Mobile hamburger button */}
      <div className="fixed top-3 left-3 z-50 md:hidden">
        <Button variant="outline" size="icon" onClick={() => setOpen(true)} className="bg-white shadow-md">
          <Menu className="w-5 h-5" />
        </Button>
      </div>

      {/* Mobile sheet sidebar */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="p-0 w-64 flex flex-col">
          <VisuallyHidden><SheetTitle>Menu de navegacion</SheetTitle></VisuallyHidden>
          <SidebarContent tenant={tenant} modules={modules} path={path} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
