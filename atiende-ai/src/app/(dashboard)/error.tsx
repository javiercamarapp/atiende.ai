'use client';
import { Button } from '@/components/ui/button';
export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h2 className="text-xl font-bold text-zinc-900">Algo salió mal</h2>
      <p className="text-sm text-zinc-500 mt-2">Error en el dashboard. Por favor intenta de nuevo.</p>
      <Button onClick={reset} className="mt-4">Reintentar</Button>
    </div>
  );
}
