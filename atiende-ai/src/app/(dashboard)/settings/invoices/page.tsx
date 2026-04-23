'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Download, FileText, Loader2, ExternalLink, Receipt, CheckCircle2 } from 'lucide-react';
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

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatMonth(ts: number) {
  return new Date(ts * 1000).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
}

function formatAmount(cents: number, currency: string) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function InvoiceCard({ inv, index }: { inv: Invoice; index: number }) {
  return (
    <div
      className="group relative rounded-2xl border border-zinc-200/80 bg-white p-5 transition-all duration-300 hover:shadow-lg hover:shadow-[hsl(235,84%,55%)]/5 hover:border-[hsl(235,84%,55%)]/30 hover:-translate-y-0.5"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[hsl(235,84%,55%)] to-[hsl(255,84%,60%)] flex items-center justify-center shadow-md shadow-[hsl(235,84%,55%)]/20 transition-transform duration-300 group-hover:scale-105">
            <Receipt className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-zinc-900 tracking-tight">
              {inv.number || `#${inv.id.slice(-8)}`}
            </p>
            <p className="text-[12.5px] text-zinc-400 mt-0.5 capitalize">{formatMonth(inv.date)}</p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-[17px] font-bold text-zinc-900 tabular-nums tracking-tight">
            {formatAmount(inv.amount, inv.currency)}
          </p>
          <div className="flex items-center justify-end gap-1 mt-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            <span className="text-[11px] font-medium text-emerald-600 uppercase tracking-wider">Pagada</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 pt-3.5 border-t border-zinc-100">
        <span className="text-[12px] text-zinc-400">{formatDate(inv.date)}</span>
        <div className="flex items-center gap-1.5">
          {inv.pdf && (
            <a
              href={inv.pdf}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[hsl(235,84%,55%)] text-white text-[12px] font-semibold px-3.5 py-1.5 shadow-sm shadow-[hsl(235,84%,55%)]/25 hover:bg-[hsl(235,84%,48%)] transition-all duration-200 hover:shadow-md hover:shadow-[hsl(235,84%,55%)]/30"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar PDF
            </a>
          )}
          {inv.hosted_url && (
            <a
              href={inv.hosted_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 text-zinc-600 text-[12px] font-medium px-3 py-1.5 hover:bg-zinc-50 hover:border-zinc-300 transition-all duration-200"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Ver detalle
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/billing/invoices')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setInvoices(data.invoices ?? []);
      })
      .catch(() => setError('No se pudieron cargar las facturas.'))
      .finally(() => setLoading(false));
  }, []);

  const totalPaid = invoices.reduce((s, inv) => s + inv.amount, 0);
  const currency = invoices[0]?.currency ?? 'mxn';

  return (
    <div className="w-full px-6 lg:px-10 py-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <Link
            href="/settings/billing"
            className="inline-flex items-center gap-1.5 text-[13px] text-zinc-400 hover:text-zinc-700 transition-colors mb-4"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Facturación
          </Link>
          <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Facturas</h1>
          <p className="text-[14px] text-zinc-500 mt-1">
            Historial completo de pagos procesados
          </p>
        </div>

        {invoices.length > 0 && (
          <div className="flex items-center gap-6 animate-in fade-in slide-in-from-right-4 duration-500 delay-200">
            <div className="text-right">
              <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest">Total facturado</p>
              <p className="text-2xl font-bold text-zinc-900 tabular-nums mt-0.5">
                {formatAmount(totalPaid, currency)}
              </p>
            </div>
            <div className="w-px h-10 bg-zinc-200" />
            <div className="text-right">
              <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-widest">Facturas</p>
              <p className="text-2xl font-bold text-zinc-900 tabular-nums mt-0.5">{invoices.length}</p>
            </div>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-24 animate-in fade-in duration-300">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[hsl(235,84%,55%)] to-[hsl(255,84%,60%)] flex items-center justify-center shadow-lg shadow-[hsl(235,84%,55%)]/20 mb-4">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
          <p className="text-sm text-zinc-400">Cargando facturas...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50/50 p-5 text-sm text-red-600 animate-in fade-in duration-300">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && invoices.length === 0 && (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/50 py-20 px-8 text-center animate-in fade-in zoom-in-95 duration-500">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-zinc-100 to-zinc-200 flex items-center justify-center mb-5">
            <FileText className="w-7 h-7 text-zinc-400" />
          </div>
          <p className="text-[15px] font-semibold text-zinc-700">Sin facturas todavía</p>
          <p className="text-[13px] text-zinc-400 mt-1.5 max-w-sm mx-auto leading-relaxed">
            Tus facturas aparecerán aquí automáticamente una vez que se procese tu primer pago.
          </p>
        </div>
      )}

      {/* Invoice grid */}
      {!loading && invoices.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
          {invoices.map((inv, i) => (
            <InvoiceCard key={inv.id} inv={inv} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
