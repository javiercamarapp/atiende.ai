'use client'

import { useEffect } from 'react'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function InsuranceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[insurance]', error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="rounded-full bg-red-50 p-3 mb-4">
        <AlertCircle className="h-6 w-6 text-red-600" />
      </div>
      <h2 className="text-lg font-semibold text-zinc-900 mb-1">
        Algo salio mal
      </h2>
      <p className="text-sm text-zinc-500 mb-6 text-center max-w-md">
        Ocurrio un error al cargar el modulo de seguros. Intenta nuevamente o
        contacta soporte si el problema persiste.
      </p>
      <Button onClick={reset} variant="outline">
        Reintentar
      </Button>
    </div>
  )
}
