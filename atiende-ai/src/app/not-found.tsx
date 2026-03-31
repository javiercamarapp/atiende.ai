import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-gray-200">404</h1>
        <h2 className="text-2xl font-bold">Página no encontrada</h2>
        <p className="text-gray-600">La página que buscas no existe.</p>
        <Link href="/" className="inline-block bg-emerald-600 text-white px-6 py-2 rounded-lg hover:bg-emerald-700 transition-colors">
          Ir al inicio
        </Link>
      </div>
    </div>
  );
}
