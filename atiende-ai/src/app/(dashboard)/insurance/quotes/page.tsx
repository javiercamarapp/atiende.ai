import { createServerSupabase } from '@/lib/supabase/server'
import { FileText } from 'lucide-react'

export default async function InsuranceQuotesPage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', user!.id)
    .single()

  const { data: quotes } = await supabase
    .from('ins_quote_requests')
    .select('*, ins_quotes(*, ins_carriers(name, slug))')
    .eq('tenant_id', tenant!.id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Cotizaciones de Seguros</h1>

      {(!quotes || quotes.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText className="w-12 h-12 text-zinc-300 mb-4" />
          <h3 className="text-lg font-medium text-zinc-900">Sin cotizaciones</h3>
          <p className="text-sm text-zinc-500 mt-1">
            Las cotizaciones generadas por el multicotizador aparecerán aquí
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map((q) => (
            <div
              key={q.id}
              className="p-4 rounded-lg border border-zinc-200 hover:border-zinc-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{q.client_name}</p>
                  <p className="text-sm text-zinc-500">
                    {q.insurance_line === 'auto' ? 'Seguro de Auto' : q.insurance_line}
                    {q.vehicle_brand && ` — ${q.vehicle_brand} ${q.vehicle_model} ${q.vehicle_year}`}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    q.status === 'complete' ? 'bg-zinc-900 text-white' :
                    q.status === 'quoting' ? 'bg-zinc-100 text-zinc-700' :
                    q.status === 'error' ? 'bg-red-50 text-red-700' :
                    'bg-zinc-100 text-zinc-600'
                  }`}>
                    {q.status === 'complete' ? 'Completada' :
                     q.status === 'quoting' ? 'Cotizando...' :
                     q.status === 'partial' ? 'Parcial' :
                     q.status === 'error' ? 'Error' : q.status}
                  </span>
                  <p className="text-xs text-zinc-400 mt-1">
                    {q.carriers_succeeded}/{q.carriers_targeted} aseguradoras
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
