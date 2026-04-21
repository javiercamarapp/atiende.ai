'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Upload, Loader2 } from 'lucide-react';

export function KnowledgeAdvancedDocs({ tenantId }: { tenantId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const onUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('tenantId', tenantId);
      const res = await fetch('/api/knowledge/upload', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Fallo la subida');
      toast.success(`${file.name} procesado. Refresca para ver fragmentos.`);
      setFile(null);
    } catch {
      toast.error('Error al subir. Intenta otro archivo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-5">
      <label className="block border-2 border-dashed border-zinc-200 rounded-2xl p-8 text-center hover:border-[hsl(var(--brand-blue))] transition cursor-pointer bg-zinc-50/50">
        <input
          type="file"
          accept=".pdf,.doc,.docx,.txt,.md,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <Upload className="w-10 h-10 text-zinc-400 mx-auto" />
        <p className="mt-3 text-sm font-medium text-zinc-900">
          {file ? file.name : 'Arrastra un archivo o haz click para seleccionar'}
        </p>
        <p className="text-xs text-zinc-500 mt-1">PDF, Word, TXT, CSV — hasta 10 MB</p>
      </label>

      {file && (
        <div className="flex items-center gap-2">
          <button
            onClick={onUpload}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-[hsl(var(--brand-blue))] text-white hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            Subir y procesar
          </button>
          <button
            onClick={() => setFile(null)}
            className="text-sm text-zinc-600 hover:text-zinc-900 px-3 py-2"
          >
            Cancelar
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-[hsl(var(--brand-blue-soft))] p-5">
        <p className="text-[11px] uppercase tracking-wider text-[hsl(var(--brand-blue))] font-semibold">Tips</p>
        <ul className="mt-2 space-y-1.5 text-xs text-zinc-700">
          <li>• Menús, listas de precios y FAQs son ideales para el agente.</li>
          <li>• Catálogos extensos: divide por categoría para mejor búsqueda.</li>
          <li>• Protocolos clínicos en PDF se extraen como texto y se chunk-ean automáticamente.</li>
        </ul>
      </div>
    </div>
  );
}
