'use client';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    console.error('[error-boundary]', error?.message, error?.stack);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4 max-w-lg mx-auto px-4">
        <h2 className="text-2xl font-bold">Algo salió mal</h2>
        <p className="text-gray-600">Hubo un error inesperado. Por favor intenta de nuevo.</p>
        <details className="text-left text-xs bg-gray-50 rounded-lg p-3 mt-2">
          <summary className="cursor-pointer text-gray-500">Detalles del error (para soporte)</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words text-red-700">
            {error?.message || 'Sin mensaje'}
            {'\n\n'}
            {error?.stack || 'Sin stack trace'}
          </pre>
        </details>
        <button onClick={reset} className="bg-zinc-900 text-white px-6 py-2 rounded-lg hover:bg-zinc-800 transition-colors">
          Intentar de nuevo
        </button>
      </div>
    </div>
  );
}
