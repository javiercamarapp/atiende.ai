'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Download, FileText, Loader2, ExternalLink } from 'lucide-react';
import Link from 'next/link';

interface Invoice {
  id: string;
  number: string | null;
  date: number;
  amount: number;
  currency: string;
  status: string | null;
  pdf: string | null;
  hosted_url: string | null;
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/billing/invoices')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setInvoices(data.invoices ?? []);
        }
      })
      .catch(() => setError('No se pudieron cargar las facturas.'))
      .finally(() => setLoading(false));
  }, []);

  function formatDate(ts: number) {
    return new Date(ts * 1000).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  function formatAmount(cents: number, currency: string) {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link
        href="/settings/billing"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900 transition mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Facturación
      </Link>

      <h1 className="text-xl font-semibold text-zinc-900 mb-1">Facturas</h1>
      <p className="text-sm text-zinc-500 mb-6">
        Historial de facturas pagadas. Descarga el PDF o consulta el detalle en línea.
      </p>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && invoices.length === 0 && (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-8 text-center">
          <FileText className="w-10 h-10 mx-auto text-zinc-300 mb-3" />
          <p className="text-sm text-zinc-500">Aún no tienes facturas.</p>
          <p className="text-xs text-zinc-400 mt-1">
            Aparecerán aquí una vez que se procese tu primer pago.
          </p>
        </div>
      )}

      {!loading && invoices.length > 0 && (
        <div className="rounded-xl border border-zinc-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200">
                <th className="text-left px-4 py-2.5 font-medium text-zinc-600">Factura</th>
                <th className="text-left px-4 py-2.5 font-medium text-zinc-600">Fecha</th>
                <th className="text-right px-4 py-2.5 font-medium text-zinc-600">Monto</th>
                <th className="text-right px-4 py-2.5 font-medium text-zinc-600">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/50 transition">
                  <td className="px-4 py-3">
                    <span className="font-medium text-zinc-900">{inv.number || inv.id.slice(-8)}</span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{formatDate(inv.date)}</td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-900">
                    {formatAmount(inv.amount, inv.currency)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {inv.pdf && (
                        <a
                          href={inv.pdf}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(235,84%,55%)] hover:text-[hsl(235,84%,45%)] transition"
                        >
                          <Download className="w-3.5 h-3.5" />
                          PDF
                        </a>
                      )}
                      {inv.hosted_url && (
                        <a
                          href={inv.hosted_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-700 transition"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          Ver
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
