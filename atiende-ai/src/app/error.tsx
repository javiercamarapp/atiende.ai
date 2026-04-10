'use client';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[error-boundary]', error?.message, error?.stack);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-bold">Algo salió mal</h2>
        <p className="text-gray-600">Hubo un error inesperado. Por favor intenta de nuevo.</p>
        <button onClick={reset} className="bg-emerald-600 text-white px-6 py-2 rounded-lg hover:bg-emerald-700 transition-colors">
          Intentar de nuevo
        </button>
      </div>
    </div>
  );
}
