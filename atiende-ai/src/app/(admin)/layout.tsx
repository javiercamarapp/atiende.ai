// ─────────────────────────────────────────────────────────────────────────────
// Admin layout — Javier-only. Verifica role=admin en app_metadata o email allowlist.
// Usa el dashboard-shell dark theme para consistencia.
// ─────────────────────────────────────────────────────────────────────────────

import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

const ADMIN_EMAILS = ['javier@atiende.ai', 'admin@atiende.ai'];

interface NavItem {
  href: string;
  label: string;
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/tenants', label: 'Tenants' },
  { href: '/admin/agents', label: 'Agents' },
  { href: '/admin/prompts', label: 'Prompts' },
  { href: '/admin/fraud', label: 'Fraud' },
  { href: '/admin/faq-gaps', label: 'FAQ Gaps' },
  { href: '/admin/analytics', label: 'Analytics' },
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Doble gate: app_metadata.role === 'admin' O email en allowlist
  const role = (user.app_metadata as { role?: string } | undefined)?.role;
  const allowed = role === 'admin' || ADMIN_EMAILS.includes(user.email || '');
  if (!allowed) redirect('/home');

  return (
    <div className="dashboard-shell min-h-screen">
      <nav className="glass-panel border-b border-white/5 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6 overflow-x-auto">
          <h1 className="font-semibold text-sm text-white whitespace-nowrap">
            atiende.ai <span className="text-emerald-400 text-[10px] font-medium uppercase tracking-wider ml-1">Admin</span>
          </h1>
          <div className="h-4 w-px bg-white/10" />
          <ul className="flex items-center gap-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="px-3 py-1.5 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/5 transition whitespace-nowrap"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <span className="text-[11px] text-white/40 whitespace-nowrap">{user.email}</span>
      </nav>
      <main className="p-8 max-w-7xl mx-auto">
        <div className="animate-element">{children}</div>
      </main>
    </div>
  );
}
