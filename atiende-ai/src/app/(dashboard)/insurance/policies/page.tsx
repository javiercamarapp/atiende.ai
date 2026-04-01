import { createServerSupabase } from '@/lib/supabase/server'
import { Shield } from 'lucide-react'

export default async function InsurancePoliciesPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', user!.id)
    .single()

  const { data: policies } = await supabase
    .from('ins_policies')
    .select('*, ins_carriers(name, slug)')
    .eq('tenant_id', tenant!.id)
    .order('end_date', { ascending: true })
    .limit(50)

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Pólizas</h1>

      {(!policies || policies.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Shield className="w-12 h-12 text-zinc-300 mb-4" />
          <h3 className="text-lg font-medium text-zinc-900">Sin pólizas</h3>
          <p className="text-sm text-zinc-500 mt-1">
            Las pólizas emitidas aparecerán aquí para gestión y renovaciones
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {policies.map((p) => {
            const daysToRenewal = Math.ceil(
              (new Date(p.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            )
            return (
              <div
                key={p.id}
                className="p-4 rounded-lg border border-zinc-200 hover:border-zinc-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {(p.ins_carriers as Record<string, string>)?.name} — #{p.policy_number}
                    </p>
                    <p className="text-sm text-zinc-500">
                      {p.insurance_line === 'auto' ? 'Auto' : p.insurance_line}
                      {p.total_premium && ` — $${Number(p.total_premium).toLocaleString('es-MX')} MXN`}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      p.status === 'active' ? 'bg-green-50 text-green-700' :
                      p.status === 'expired' ? 'bg-red-50 text-red-700' :
                      'bg-zinc-100 text-zinc-600'
                    }`}>
                      {p.status === 'active' ? 'Activa' :
                       p.status === 'expired' ? 'Vencida' :
                       p.status === 'pending_payment' ? 'Pago pendiente' : p.status}
                    </span>
                    {daysToRenewal <= 30 && daysToRenewal >= 0 && (
                      <p className="text-xs text-amber-600 mt-1">
                        Renueva en {daysToRenewal} días
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
