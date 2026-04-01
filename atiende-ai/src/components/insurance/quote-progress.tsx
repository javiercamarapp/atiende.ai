'use client'

import { useEffect, useRef, useState } from 'react'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, XCircle, Clock, Trophy } from 'lucide-react'

interface CarrierResult {
  carrier_name: string
  carrier_slug: string
  annual_premium: number | null
  status: string
}

interface ProgressData {
  request_id: string
  total: number
  completed: number
  failed: number
  results: CarrierResult[]
  status: string
  best_price: number | null
}

interface QuoteProgressProps {
  requestId: string
}

export function QuoteProgress({ requestId }: QuoteProgressProps) {
  const [data, setData] = useState<ProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(`/api/insurance/stream?id=${requestId}`)
    eventSourceRef.current = es

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as ProgressData
        setData(parsed)

        if (parsed.status === 'complete' || parsed.status === 'error' || parsed.status === 'expired') {
          es.close()
        }
      } catch {
        // ignore parse errors on heartbeats
      }
    }

    es.onerror = () => {
      setError('Se perdio la conexion. Recarga la pagina para ver los resultados.')
      es.close()
    }

    return () => {
      es.close()
    }
  }, [requestId])

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-3 py-4">
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Clock className="w-4 h-4 animate-spin" />
          Conectando con aseguradoras...
        </div>
        <Progress value={0} />
      </div>
    )
  }

  const progressPercent = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0
  const isComplete = data.status === 'complete'
  const successResults = data.results
    .filter((r) => r.annual_premium != null)
    .sort((a, b) => (a.annual_premium ?? 0) - (b.annual_premium ?? 0))
  const bestPrice = successResults[0]?.annual_premium ?? null

  return (
    <div className="space-y-4 py-2">
      {/* Progress header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-600">
            {isComplete ? (
              <span className="flex items-center gap-1 text-green-600 font-medium">
                <CheckCircle className="w-4 h-4" />
                Cotizacion completada
              </span>
            ) : (
              `${data.completed} de ${data.total} aseguradoras respondieron`
            )}
          </span>
          <span className="text-zinc-400 tabular-nums">{progressPercent}%</span>
        </div>
        <Progress value={progressPercent} />
        {data.failed > 0 && (
          <p className="text-xs text-zinc-400">
            {data.failed} aseguradora(s) con error
          </p>
        )}
      </div>

      {/* Results list */}
      {data.results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
            Resultados
          </p>
          <div className="space-y-1.5">
            {data.results
              .sort((a, b) => {
                if (a.annual_premium == null && b.annual_premium == null) return 0
                if (a.annual_premium == null) return 1
                if (b.annual_premium == null) return -1
                return a.annual_premium - b.annual_premium
              })
              .map((result) => {
                const isBest = result.annual_premium != null && result.annual_premium === bestPrice
                return (
                  <div
                    key={result.carrier_slug}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                      isBest
                        ? 'border-green-200 bg-green-50/50'
                        : 'border-zinc-100'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {isBest && <Trophy className="w-3.5 h-3.5 text-green-600" />}
                      <span className={isBest ? 'font-medium' : ''}>
                        {result.carrier_name}
                      </span>
                    </div>
                    {result.annual_premium != null ? (
                      <span className={`font-mono text-sm ${isBest ? 'text-green-700 font-semibold' : ''}`}>
                        ${result.annual_premium.toLocaleString('es-MX')} /ano
                      </span>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {result.status === 'error' || result.status === 'timeout' ? (
                          <XCircle className="w-3 h-3 mr-1 text-red-400" />
                        ) : (
                          <Clock className="w-3 h-3 mr-1" />
                        )}
                        {result.status === 'error' ? 'Error' :
                         result.status === 'timeout' ? 'Timeout' :
                         result.status === 'declined' ? 'Declinada' :
                         'Pendiente'}
                      </Badge>
                    )}
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Completion summary */}
      {isComplete && successResults.length > 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-1">
          <p className="text-sm font-medium text-green-800">
            Mejor precio: ${bestPrice?.toLocaleString('es-MX')} /ano
          </p>
          <p className="text-xs text-green-600">
            {successResults.length} cotizacion(es) exitosa(s) de {data.total} aseguradoras
          </p>
        </div>
      )}

      {isComplete && successResults.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">
            Ninguna aseguradora pudo cotizar. Verifica los datos e intenta nuevamente.
          </p>
        </div>
      )}
    </div>
  )
}
