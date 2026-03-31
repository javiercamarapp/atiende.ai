import { supabaseAdmin } from '@/lib/supabase/admin';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

async function getTenantDetail(id: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { data: tenant },
    { count: messageCount },
    { data: analytics },
    { data: conversations },
    { count: knowledgeCount },
    { data: marketplaceAgents },
  ] = await Promise.all([
    supabaseAdmin.from('tenants').select('*').eq('id', id).single(),
    supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', id)
      .gte('created_at', thirtyDaysAgo),
    supabaseAdmin
      .from('daily_analytics')
      .select('date, messages_inbound, messages_outbound, llm_cost')
      .eq('tenant_id', id)
      .gte('date', thirtyDaysAgo.split('T')[0])
      .order('date', { ascending: false }),
    supabaseAdmin
      .from('conversations')
      .select('id, status, channel, created_at, last_message_at, contact:contact_id(name, phone)')
      .eq('tenant_id', id)
      .order('last_message_at', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('knowledge_chunks')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', id),
    supabaseAdmin
      .from('marketplace_installs')
      .select('id, agent_id, status, installed_at, marketplace_agents(name)')
      .eq('tenant_id', id)
      .eq('status', 'active'),
  ]);

  if (!tenant) return null;

  const totalLlmCost = (analytics || []).reduce(
    (sum, a) => sum + (Number(a.llm_cost) || 0),
    0
  );

  return {
    tenant,
    messageCount: messageCount || 0,
    analytics: analytics || [],
    conversations: conversations || [],
    knowledgeCount: knowledgeCount || 0,
    marketplaceAgents: marketplaceAgents || [],
    totalLlmCost,
  };
}

async function handleUpdate(formData: FormData) {
  'use server';
  const tenantId = formData.get('tenantId') as string;
  const field = formData.get('field') as string;
  const value = formData.get('value') as string;

  if (!tenantId || !field || !value) return;

  const allowedFields = ['status', 'plan', 'name', 'email', 'phone', 'city'];
  if (!allowedFields.includes(field)) return;

  await supabaseAdmin.from('tenants').update({ [field]: value }).eq('id', tenantId);
}

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getTenantDetail(id);

  if (!data) notFound();

  const { tenant, messageCount, analytics, conversations, knowledgeCount, marketplaceAgents, totalLlmCost } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/tenants" className="text-sm text-zinc-500 hover:text-zinc-900">
          &larr; Back
        </Link>
        <h2 className="text-2xl font-bold text-zinc-900">{tenant.name}</h2>
        <StatusBadge status={tenant.status as string} />
        <PlanBadge plan={tenant.plan as string} />
      </div>

      {/* Tenant Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg border border-zinc-200 p-6 space-y-3">
          <h3 className="font-semibold text-zinc-900">Info</h3>
          <InfoRow label="ID" value={tenant.id} />
          <InfoRow label="Email" value={tenant.email as string} />
          <InfoRow label="Phone" value={tenant.phone as string} />
          <InfoRow label="Type" value={tenant.business_type as string} />
          <InfoRow label="City" value={`${tenant.city || ''}, ${tenant.state || ''}`} />
          <InfoRow label="Created" value={new Date(tenant.created_at as string).toLocaleString()} />
          <InfoRow label="Chat Agent" value={tenant.has_chat_agent ? 'Yes' : 'No'} />
          <InfoRow label="Voice Agent" value={tenant.has_voice_agent ? 'Yes' : 'No'} />
          <InfoRow label="WA Phone ID" value={(tenant.wa_phone_number_id as string) || 'Not connected'} />
        </div>

        <div className="space-y-6">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Messages (30d)" value={messageCount.toLocaleString()} />
            <StatCard label="LLM Cost (30d)" value={`$${totalLlmCost.toFixed(2)}`} color="amber" />
            <StatCard label="Knowledge Chunks" value={knowledgeCount.toLocaleString()} />
            <StatCard label="Marketplace Agents" value={marketplaceAgents.length.toString()} />
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-lg border border-zinc-200 p-6 space-y-3">
            <h3 className="font-semibold text-zinc-900">Quick Actions</h3>
            <div className="flex flex-wrap gap-2">
              <ActionButton tenantId={tenant.id} field="status" value="active" label="Activate" color="emerald" />
              <ActionButton tenantId={tenant.id} field="status" value="paused" label="Pause" color="amber" />
              <ActionButton tenantId={tenant.id} field="status" value="cancelled" label="Cancel" color="red" />
            </div>
            <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-100">
              <ActionButton tenantId={tenant.id} field="plan" value="trial" label="Set Trial" color="zinc" />
              <ActionButton tenantId={tenant.id} field="plan" value="starter" label="Set Starter" color="blue" />
              <ActionButton tenantId={tenant.id} field="plan" value="professional" label="Set Professional" color="purple" />
              <ActionButton tenantId={tenant.id} field="plan" value="business" label="Set Business" color="emerald" />
              <ActionButton tenantId={tenant.id} field="plan" value="enterprise" label="Set Enterprise" color="zinc" />
            </div>
          </div>
        </div>
      </div>

      {/* Daily Analytics */}
      {analytics.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 p-6">
          <h3 className="font-semibold text-zinc-900 mb-4">Daily Analytics (30d)</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-zinc-500 border-b">
                <th className="pb-2">Date</th>
                <th className="pb-2">Inbound</th>
                <th className="pb-2">Outbound</th>
                <th className="pb-2">LLM Cost</th>
              </tr>
            </thead>
            <tbody>
              {analytics.slice(0, 14).map((a) => (
                <tr key={a.date as string} className="border-b border-zinc-50">
                  <td className="py-2 text-zinc-700">{a.date as string}</td>
                  <td className="py-2 font-mono">{a.messages_inbound as number}</td>
                  <td className="py-2 font-mono">{a.messages_outbound as number}</td>
                  <td className="py-2 font-mono text-amber-600">${(Number(a.llm_cost) || 0).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Marketplace Agents */}
      {marketplaceAgents.length > 0 && (
        <div className="bg-white rounded-lg border border-zinc-200 p-6">
          <h3 className="font-semibold text-zinc-900 mb-4">Active Marketplace Agents</h3>
          <div className="space-y-2">
            {marketplaceAgents.map((ma) => {
              const agent = ma.marketplace_agents as { name: string } | null;
              return (
                <div key={ma.id} className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
                  <span className="text-sm text-zinc-700">{agent?.name || ma.agent_id}</span>
                  <span className="text-xs text-zinc-400">
                    Installed {new Date(ma.installed_at as string).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Conversations */}
      <div className="bg-white rounded-lg border border-zinc-200 p-6">
        <h3 className="font-semibold text-zinc-900 mb-4">Recent Conversations</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 border-b">
              <th className="pb-2">Contact</th>
              <th className="pb-2">Channel</th>
              <th className="pb-2">Status</th>
              <th className="pb-2">Last Message</th>
            </tr>
          </thead>
          <tbody>
            {conversations.map((c) => {
              const contact = c.contact as { name: string; phone: string } | null;
              return (
                <tr key={c.id} className="border-b border-zinc-50">
                  <td className="py-2">
                    <span className="text-zinc-900">{contact?.name || 'Unknown'}</span>
                    <span className="text-xs text-zinc-400 ml-2">{contact?.phone || ''}</span>
                  </td>
                  <td className="py-2 text-zinc-600">{c.channel as string}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      c.status === 'open' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600'
                    }`}>
                      {c.status as string}
                    </span>
                  </td>
                  <td className="py-2 text-zinc-500 text-xs">
                    {c.last_message_at ? new Date(c.last_message_at as string).toLocaleString() : '--'}
                  </td>
                </tr>
              );
            })}
            {conversations.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-zinc-400">No conversations yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* System Prompt Preview */}
      {tenant.chat_system_prompt && (
        <div className="bg-white rounded-lg border border-zinc-200 p-6">
          <h3 className="font-semibold text-zinc-900 mb-4">Chat System Prompt</h3>
          <pre className="text-xs text-zinc-600 bg-zinc-50 p-4 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
            {tenant.chat_system_prompt as string}
          </pre>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-900 font-mono text-xs max-w-[300px] truncate">{value || '--'}</span>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  const colorClasses: Record<string, string> = {
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
  };
  return (
    <div className="bg-white rounded-lg border border-zinc-200 p-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 ${color ? colorClasses[color] || '' : 'text-zinc-900'}`}>{value}</p>
    </div>
  );
}

function ActionButton({
  tenantId,
  field,
  value,
  label,
  color,
}: {
  tenantId: string;
  field: string;
  value: string;
  label: string;
  color: string;
}) {
  const colorClasses: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200',
    amber: 'bg-amber-100 text-amber-700 hover:bg-amber-200',
    red: 'bg-red-100 text-red-700 hover:bg-red-200',
    blue: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
    purple: 'bg-purple-100 text-purple-700 hover:bg-purple-200',
    zinc: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200',
  };
  return (
    <form action={handleUpdateAction}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={value} />
      <button type="submit" className={`px-3 py-1 text-xs rounded-md font-medium ${colorClasses[color] || colorClasses.zinc}`}>
        {label}
      </button>
    </form>
  );
}

async function handleUpdateAction(formData: FormData) {
  'use server';
  const tenantId = formData.get('tenantId') as string;
  const field = formData.get('field') as string;
  const value = formData.get('value') as string;

  if (!tenantId || !field || !value) return;

  const allowedFields = ['status', 'plan', 'name', 'email', 'phone', 'city'];
  if (!allowedFields.includes(field)) return;

  await supabaseAdmin.from('tenants').update({ [field]: value }).eq('id', tenantId);
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    trial: 'bg-amber-100 text-amber-700',
    starter: 'bg-blue-100 text-blue-700',
    professional: 'bg-purple-100 text-purple-700',
    business: 'bg-emerald-100 text-emerald-700',
    enterprise: 'bg-zinc-800 text-white',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[plan] || 'bg-zinc-100 text-zinc-600'}`}>
      {plan}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700',
    paused: 'bg-amber-100 text-amber-700',
    cancelled: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-zinc-100 text-zinc-600'}`}>
      {status}
    </span>
  );
}
