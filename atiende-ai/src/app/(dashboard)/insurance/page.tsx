import { createServerSupabase } from '@/lib/supabase/server'
import { Shield, FileText, Building2, CreditCard } from 'lucide-react'
import Link from 'next/link'

export default async function InsurancePage() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('user_id', user!.id)
    .single()

  const tenantId = tenant?.id

  // Fetch stats
  const [quotesRes, policiesRes, carriersRes] = await Promise.all([
    supabase
      .from('ins_quote_requests')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId),
    supabase
      .from('ins_policies')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'active'),
    supabase
      .from('ins_carrier_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('is_active', true),
  ])

  const stats = [
    {
      label: 'Cotizaciones',
      value: quotesRes.count ?? 0,
      icon: FileText,
      href: '/insurance/quotes',
      color: 'text-zinc-500 bg-zinc-50',
    },
    {
      label: 'Pólizas activas',
      value: policiesRes.count ?? 0,
      icon: Shield,
      href: '/insurance/policies',
      color: 'text-zinc-500 bg-zinc-50',
    },
    {
      label: 'Aseguradoras conectadas',
      value: carriersRes.count ?? 0,
      icon: Building2,
      href: '/insurance/carriers',
      color: 'text-zinc-500 bg-zinc-50',
    },
  ]

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">Módulo de Seguros</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="flex items-center gap-4 p-4 rounded-lg border border-zinc-200 hover:border-zinc-300 transition-colors"
          >
            <div className={`p-3 rounded-lg ${stat.color}`}>
              <stat.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-sm text-zinc-500">{stat.label}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-200 p-8 text-center">
        <Shield className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-zinc-900">
          Multicotizador Agéntico
        </h3>
        <p className="text-sm text-zinc-500 mt-2 max-w-md mx-auto">
          Cotiza automáticamente en 15+ aseguradoras simultáneamente.
          Conecta tus credenciales de portales en la sección de Aseguradoras para comenzar.
        </p>
        <Link
          href="/insurance/carriers"
          className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-zinc-900 text-white rounded-lg text-sm hover:bg-zinc-800 transition-colors"
        >
          <Building2 className="w-4 h-4" />
          Conectar aseguradoras
        </Link>
      </div>
    </div>
  )
}
