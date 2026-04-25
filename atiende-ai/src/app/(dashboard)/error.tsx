'use client';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard-error-boundary]', error?.message, error?.digest);
  }, [error]);

  // Distingo errores comunes para mostrar mensaje útil
  const isNetwork = /fetch|network|ECONN|ENOTFOUND/i.test(error?.message || '');
  const isAuth = /unauthorized|401|403|JWT/i.test(error?.message || '');

  let title = 'Algo salió mal';
  let body = 'Hubo un error inesperado en el dashboard. Reintentá o recargá la página.';
  let primaryAction = 'Reintentar';

  if (isNetwork) {
    title = 'Sin conexión';
    body = 'No pudimos conectar con el servidor. Revisá tu internet y reintentá.';
  } else if (isAuth) {
    title = 'Tu sesión expiró';
    body = 'Por seguridad cerramos tu sesión. Iniciá sesión de nuevo para continuar.';
    primaryAction = 'Ir al login';
  }

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
      <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center mb-3">
        <AlertTriangle className="w-6 h-6" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-bold text-zinc-900">{title}</h2>
      <p className="text-sm text-zinc-500 mt-2 max-w-md leading-relaxed">{body}</p>

      {error?.digest && (
        <p className="text-[11px] text-zinc-400 mt-3 font-mono">
          ID error: {error.digest}
        </p>
      )}

      <Button
        onClick={() => {
          if (isAuth) {
            window.location.href = '/login';
          } else {
            reset();
          }
        }}
        className="mt-5"
      >
        {primaryAction}
      </Button>
    </div>
  );
}
