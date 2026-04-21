'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

export function KnowledgeAdvancedPrompt({
  initialPrompt,
  initialWelcome,
}: {
  initialPrompt: string;
  initialWelcome: string;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [welcome, setWelcome] = useState(initialWelcome);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/tenant/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_system_prompt: prompt,
          welcome_message: welcome,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success('Prompt actualizado');
    } catch {
      toast.error('Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
          Mensaje de bienvenida
        </label>
        <input
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          className="mt-1.5 w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2.5 focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
        />
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
          Prompt del sistema (personalidad del agente)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={12}
          placeholder="Eres el asistente virtual de una clínica dental. Tu tono es cercano pero profesional…"
          className="mt-1.5 w-full text-sm rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2.5 font-mono leading-relaxed focus:border-[hsl(var(--brand-blue))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--brand-blue-soft))]"
        />
        <p className="text-[11px] text-zinc-500 mt-1.5">
          Se concatena con las respuestas de cada zona y los documentos en cada mensaje.
        </p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-[hsl(var(--brand-blue))] text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Guardar cambios
        </button>
      </div>
    </div>
  );
}
