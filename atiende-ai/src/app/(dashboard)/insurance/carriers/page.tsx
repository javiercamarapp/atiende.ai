import { createServerSupabase } from '@/lib/supabase/server'
import { Building2, CheckCircle, XCircle } from 'lucide-react'

export default async function InsuranceCarriersPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', user!.id)
    .single()

  const [carriersRes, credsRes] = await Promise.all([
    supabase
      .from('ins_carriers')
      .select('*')
      .eq('is_active', true)
      .order('market_share_auto', { ascending: false }),
    supabase
      .from('ins_carrier_credentials')
      .select('carrier_id, is_active, last_login_success, login_failure_count')
      .eq('tenant_id', tenant!.id),
  ])

  const carriers = carriersRes.data ?? []
  const creds = credsRes.data ?? []
  const credsByCarrier = new Map(creds.map(c => [c.carrier_id, c]))

  return (
    <div>
      <h1 className="text-xl font-bold mb-2">Aseguradoras</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Conecta tus credenciales de cada portal para habilitar la cotización automática
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {carriers.map((carrier) => {
          const cred = credsByCarrier.get(carrier.id)
          const isConnected = cred?.is_active

          return (
            <div
              key={carrier.id}
              className={`p-4 rounded-lg border transition-colors ${
                isConnected
                  ? 'border-emerald-200 bg-emerald-50/50'
                  : 'border-zinc-200 hover:border-zinc-300'
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-zinc-400" />
                  <h3 className="font-medium">{carrier.name}</h3>
                </div>
                {isConnected ? (
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                ) : (
                  <XCircle className="w-5 h-5 text-zinc-300" />
                )}
              </div>

              <div className="space-y-1 text-xs text-zinc-500">
                <p>Tipo: {carrier.portal_type === 'api' ? 'API directa' : 'Portal web'}</p>
                <p>Market share: {carrier.market_share_auto}%</p>
                <p>
                  Líneas:{' '}
                  {(carrier.supported_lines as string[]).map(l =>
                    l === 'auto' ? 'Auto' :
                    l === 'vida' ? 'Vida' :
                    l === 'gastos_medicos' ? 'GMM' :
                    l === 'hogar' ? 'Hogar' :
                    l === 'negocio' ? 'Negocio' : l
                  ).join(', ')}
                </p>
                <p>
                  Estado:{' '}
                  <span className={`inline-flex items-center ${
                    carrier.health_status === 'healthy' ? 'text-emerald-600' :
                    carrier.health_status === 'degraded' ? 'text-amber-600' :
                    'text-red-600'
                  }`}>
                    {carrier.health_status === 'healthy' ? 'Operativo' :
                     carrier.health_status === 'degraded' ? 'Degradado' : 'Caído'}
                  </span>
                </p>
              </div>

              {!isConnected && (
                <p className="text-xs text-zinc-400 mt-3 italic">
                  Credenciales no configuradas
                </p>
              )}
              {cred && cred.login_failure_count > 0 && (
                <p className="text-xs text-red-500 mt-2">
                  {cred.login_failure_count} login(s) fallido(s)
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
