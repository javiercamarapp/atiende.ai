import { createServerSupabase } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { MarketplaceGrid } from '@/components/marketplace/grid';
import { Bot, Sparkles, Zap, TrendingUp } from 'lucide-react';

export default async function AgentsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: tenant } = await supabase
    .from('tenants').select('id,plan').eq('user_id', user.id).single();
  if (!tenant) redirect('/onboarding');
  const { data: all } = await supabase
    .from('marketplace_agents').select('*').eq('is_active', true).order('category');
  const { data: active } = await supabase
    .from('tenant_agents').select('agent_id').eq('tenant_id', tenant.id).eq('is_active', true);
  const ids = new Set((active || []).map(a => a.agent_id));

  const totalAgents = all?.length ?? 0;
  const activeCount = ids.size;
  const categories = new Set((all || []).map(a => a.category)).size;

  const stats = [
    { label: 'Agentes activos', value: activeCount, icon: Bot, tint: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]' },
    { label: 'Disponibles', value: totalAgents, icon: Sparkles, tint: 'bg-emerald-50 text-emerald-600' },
    { label: 'Categorías', value: categories, icon: Zap, tint: 'bg-amber-50 text-amber-600' },
    { label: 'Ahorro estimado', value: '$2,400', icon: TrendingUp, tint: 'bg-violet-50 text-violet-600' },
  ];

  return (
    <div className="space-y-4">
      <header className="animate-element">
        <p className="text-sm text-zinc-500">
          Activa agentes autónomos que trabajan 24/7 por tu consultorio.
        </p>
      </header>

      {/* Stat cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-element animate-delay-100">
        {stats.map((s) => (
          <div key={s.label} className="glass-card p-4">
            <div className="flex items-center justify-between">
              <span className={`w-9 h-9 rounded-full flex items-center justify-center ${s.tint}`}>
                <s.icon className="w-4 h-4" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-zinc-900 tabular-nums">{s.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </section>

      {/* Marketplace grid (existing component) */}
      <section className="glass-card p-6 animate-element animate-delay-200">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900">Marketplace de agentes</h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              Activa o desactiva con un click. Cada agente tiene su propia configuración.
            </p>
          </div>
        </div>
        <MarketplaceGrid agents={all || []} activeIds={ids} tenantId={tenant.id} />
      </section>
    </div>
  );
}
