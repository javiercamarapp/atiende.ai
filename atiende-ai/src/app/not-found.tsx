import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-zinc-200">404</h1>
        <h2 className="text-2xl font-bold text-zinc-900">Pagina no encontrada</h2>
        <p className="text-zinc-500">La pagina que buscas no existe.</p>
        <Link href="/" className="inline-block bg-zinc-900 text-white px-6 py-2 rounded-lg hover:bg-zinc-800 transition-colors">
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
