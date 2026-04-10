import Link from 'next/link';
export default function DashboardNotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <h2 className="text-xl font-bold text-zinc-900">Página no encontrada</h2>
      <p className="text-sm text-zinc-500 mt-2">Esta sección no existe.</p>
      <Link href="/home" className="text-zinc-900 mt-4 hover:text-zinc-600 hover:underline">Volver al dashboard</Link>
    </div>
  );
}
