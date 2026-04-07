import { supabaseAdmin } from '@/lib/supabase/admin';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  plan?: string;
  status?: string;
  type?: string;
}

async function getTenants(params: SearchParams) {
  let query = supabaseAdmin
    .from('tenants')
    .select('id, name, email, business_type, plan, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (params.q) {
    query = query.or(`name.ilike.%${params.q}%,email.ilike.%${params.q}%`);
  }
  if (params.plan) {
    query = query.eq('plan', params.plan);
  }
  if (params.status) {
    query = query.eq('status', params.status);
  }
  if (params.type) {
    query = query.eq('business_type', params.type);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error fetching tenants:', error);
    return [];
  }
  return data || [];
}

async function handleAction(formData: FormData) {
  'use server';
  const tenantId = formData.get('tenantId') as string;
  const action = formData.get('action') as string;

  if (!tenantId || !action) return;

  const updates: Record<string, string> = {};
  if (action === 'pause') updates.status = 'paused';
  if (action === 'activate') updates.status = 'active';
  if (action === 'cancel') updates.status = 'cancelled';
  if (['starter', 'professional', 'business', 'enterprise', 'trial'].includes(action)) {
    updates.plan = action;
  }

  if (Object.keys(updates).length > 0) {
    await supabaseAdmin.from('tenants').update(updates).eq('id', tenantId);
  }
}

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tenants = await getTenants(params);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-zinc-900">Tenants</h2>
        <span className="text-sm text-zinc-500">{tenants.length} results</span>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-3 bg-white p-4 rounded-lg border border-zinc-200">
        <input
          name="q"
          type="text"
          placeholder="Search name or email..."
          defaultValue={params.q || ''}
          className="px-3 py-2 border border-zinc-300 rounded-md text-sm flex-1 min-w-[200px]"
        />
        <select name="plan" defaultValue={params.plan || ''} className="px-3 py-2 border border-zinc-300 rounded-md text-sm">
          <option value="">All plans</option>
          <option value="trial">Trial</option>
          <option value="starter">Starter</option>
          <option value="professional">Professional</option>
          <option value="business">Business</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <select name="status" defaultValue={params.status || ''} className="px-3 py-2 border border-zinc-300 rounded-md text-sm">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select name="type" defaultValue={params.type || ''} className="px-3 py-2 border border-zinc-300 rounded-md text-sm">
          <option value="">All types</option>
          <option value="clinica_dental">Clinica Dental</option>
          <option value="restaurante">Restaurante</option>
          <option value="salon_belleza">Salon Belleza</option>
          <option value="clinica_medica">Clinica Medica</option>
          <option value="veterinaria">Veterinaria</option>
          <option value="gym">Gym</option>
          <option value="general">General</option>
        </select>
        <button type="submit" className="px-4 py-2 bg-zinc-900 text-white rounded-md text-sm hover:bg-zinc-800">
          Filter
        </button>
      </form>

      {/* Table */}
      <div className="bg-white rounded-lg border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-500 border-b bg-zinc-50">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/tenants/${t.id}`} className="font-medium text-zinc-900 hover:text-emerald-600">
                    {t.name}
                  </Link>
                  <p className="text-xs text-zinc-400">{t.email}</p>
                </td>
                <td className="px-4 py-3 text-zinc-600">{t.business_type}</td>
                <td className="px-4 py-3">
                  <PlanBadge plan={t.plan as string} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={t.status as string} />
                </td>
                <td className="px-4 py-3 text-zinc-500">
                  {new Date(t.created_at as string).toLocaleDateString()}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {t.status === 'active' ? (
                      <form action={handleAction}>
                        <input type="hidden" name="tenantId" value={t.id} />
                        <input type="hidden" name="action" value="pause" />
                        <button type="submit" className="px-2 py-1 text-xs bg-amber-100 text-amber-700 rounded hover:bg-amber-200">
                          Pause
                        </button>
                      </form>
                    ) : (
                      <form action={handleAction}>
                        <input type="hidden" name="tenantId" value={t.id} />
                        <input type="hidden" name="action" value="activate" />
                        <button type="submit" className="px-2 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200">
                          Activate
                        </button>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  No tenants found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    trial: 'bg-amber-100 text-amber-700',
    starter: 'bg-emerald-100 text-emerald-700',
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
