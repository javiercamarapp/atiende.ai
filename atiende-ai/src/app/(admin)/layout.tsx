import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';

const ADMIN_EMAILS = ['javier@atiende.ai', 'admin@atiende.ai'];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) redirect('/login');

  return (
    <div className="min-h-screen bg-zinc-50">
      <nav className="bg-zinc-900 text-white px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h1 className="font-bold text-lg">atiende.ai <span className="text-emerald-400 text-xs">ADMIN</span></h1>
          <Link href="/admin" className="text-sm text-zinc-400 hover:text-white">Dashboard</Link>
          <Link href="/admin/tenants" className="text-sm text-zinc-400 hover:text-white">Tenants</Link>
          <Link href="/admin/analytics" className="text-sm text-zinc-400 hover:text-white">Analytics</Link>
          <Link href="/admin/webhooks" className="text-sm text-zinc-400 hover:text-white">Webhooks</Link>
        </div>
        <span className="text-xs text-zinc-500">{user.email}</span>
      </nav>
      <main className="p-6 max-w-7xl mx-auto">{children}</main>
    </div>
  );
}
