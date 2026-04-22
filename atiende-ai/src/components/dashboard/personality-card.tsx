'use client';

import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { Smile, Sparkles, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Keys de personality se guardan en onboarding_responses junto al resto.
// El agent-prompt builder las lee y las concatena en el system prompt.
const PERSONALITY_KEYS = {
  tone: 'personality_tone',
  emojis: 'personality_emojis',
  greeting: 'personality_greeting',
  closing: 'personality_closing',
  phrases: 'personality_phrases',
  avoid: 'personality_avoid',
} as const;

const TONE_PRESETS = [
  { value: 'casual', label: 'Casual' },
  { value: 'cercano', label: 'Cercano' },
  { value: 'amigable', label: 'Amigable' },
  { value: 'profesional', label: 'Profesional' },
  { value: 'divertido', label: 'Divertido' },
  { value: 'formal', label: 'Formal' },
];

const EMOJI_OPTIONS = [
  { value: 'yes', label: 'Sí, usa muchos' },
  { value: 'few', label: 'Pocos, sutiles' },
  { value: 'no', label: 'Ninguno' },
];

export interface PersonalityCardProps {
  initial: {
    tone?: string;
    emojis?: string;
    greeting?: string;
    closing?: string;
    phrases?: string;
    avoid?: string;
  };
}

type Field = keyof typeof PERSONALITY_KEYS;

const LABELS: Record<Field, string> = {
  tone: 'Tono de voz',
  emojis: 'Emojis',
  greeting: 'Saludo típico',
  closing: 'Despedida',
  phrases: 'Frases características',
  avoid: 'Qué NO decir',
};

export function PersonalityCard({ initial }: PersonalityCardProps) {
  const [tone, setTone] = useState(initial.tone ?? '');
  const [emojis, setEmojis] = useState(initial.emojis ?? '');
  const [greeting, setGreeting] = useState(initial.greeting ?? '');
  const [closing, setClosing] = useState(initial.closing ?? '');
  const [phrases, setPhrases] = useState(initial.phrases ?? '');
  const [avoid, setAvoid] = useState(initial.avoid ?? '');
  const [savingField, setSavingField] = useState<Field | null>(null);
  const [savedField, setSavedField] = useState<Field | null>(null);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});

  const saveField = useCallback(async (field: Field, value: string) => {
    setSavingField(field);
    try {
      const res = await fetch('/api/knowledge/save-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionKey: PERSONALITY_KEYS[field],
          questionLabel: LABELS[field],
          answer: value,
          step: 4,
        }),
      });
      if (!res.ok) throw new Error();
      setSavedField(field);
      setTimeout(() => setSavedField(null), 1500);
    } catch {
      toast.error('No se pudo guardar. Intenta de nuevo.');
    } finally {
      setSavingField(null);
    }
  }, []);

  const debouncedSave = useCallback(
    (field: Field, value: string) => {
      if (timersRef.current[field]) clearTimeout(timersRef.current[field]);
      timersRef.current[field] = setTimeout(() => saveField(field, value), 600);
    },
    [saveField],
  );

  return (
    <section className="rounded-2xl bg-white border border-zinc-100 p-3 animate-element animate-delay-200">
      <header className="flex items-center gap-2 mb-2">
        <span className="inline-flex w-7 h-7 rounded-full items-center justify-center bg-fuchsia-50 text-fuchsia-600 shrink-0">
          <Smile className="w-3.5 h-3.5" strokeWidth={1.75} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-fuchsia-500" strokeWidth={1.75} />
            <span className="text-[9px] uppercase tracking-wider text-fuchsia-600 font-semibold">
              Personalidad
            </span>
          </div>
          <h2 className="text-[13px] font-semibold text-zinc-900 leading-tight">
            ¿Cómo habla tu bot?
          </h2>
        </div>
      </header>

      {/* Tono */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] font-medium text-zinc-700">{LABELS.tone}</label>
          <StatusDot field="tone" savingField={savingField} savedField={savedField} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TONE_PRESETS.map((t) => {
            const active = tone === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => {
                  setTone(t.value);
                  saveField('tone', t.value);
                }}
                className={cn(
                  'text-[12px] px-2.5 py-1 rounded-full border transition',
                  active
                    ? 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700 font-medium'
                    : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Emojis */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[11px] font-medium text-zinc-700">{LABELS.emojis}</label>
          <StatusDot field="emojis" savingField={savingField} savedField={savedField} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EMOJI_OPTIONS.map((e) => {
            const active = emojis === e.value;
            return (
              <button
                key={e.value}
                type="button"
                onClick={() => {
                  setEmojis(e.value);
                  saveField('emojis', e.value);
                }}
                className={cn(
                  'text-[12px] px-2.5 py-1 rounded-full border transition',
                  active
                    ? 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700 font-medium'
                    : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300',
                )}
              >
                {e.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Saludo + Despedida */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <CompactField
          label={LABELS.greeting}
          placeholder="¡Hola! ¿En qué te ayudo?"
          value={greeting}
          onChange={(v) => {
            setGreeting(v);
            debouncedSave('greeting', v);
          }}
          status={<StatusDot field="greeting" savingField={savingField} savedField={savedField} />}
        />
        <CompactField
          label={LABELS.closing}
          placeholder="¡Que tengas buen día!"
          value={closing}
          onChange={(v) => {
            setClosing(v);
            debouncedSave('closing', v);
          }}
          status={<StatusDot field="closing" savingField={savingField} savedField={savedField} />}
        />
      </div>

      {/* Frases / Evitar */}
      <div className="grid grid-cols-2 gap-2">
        <CompactArea
          label={LABELS.phrases}
          placeholder="Porfa, ¡claro!, con gusto"
          value={phrases}
          onChange={(v) => {
            setPhrases(v);
            debouncedSave('phrases', v);
          }}
          status={<StatusDot field="phrases" savingField={savingField} savedField={savedField} />}
        />
        <CompactArea
          label={LABELS.avoid}
          placeholder="Jerga técnica, anglicismos"
          value={avoid}
          onChange={(v) => {
            setAvoid(v);
            debouncedSave('avoid', v);
          }}
          status={<StatusDot field="avoid" savingField={savingField} savedField={savedField} />}
        />
      </div>
    </section>
  );
}

function StatusDot({
  field,
  savingField,
  savedField,
}: {
  field: Field;
  savingField: Field | null;
  savedField: Field | null;
}) {
  if (savingField === field) {
    return <Loader2 className="w-3 h-3 text-zinc-400 animate-spin" />;
  }
  if (savedField === field) {
    return <Check className="w-3 h-3 text-emerald-500" />;
  }
  return null;
}

function CompactField({
  label,
  placeholder,
  value,
  onChange,
  status,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  status: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-medium text-zinc-700">{label}</label>
        {status}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-[12px] rounded-lg bg-zinc-50 border border-zinc-200 px-2 py-1 focus:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-100"
      />
    </div>
  );
}

function CompactArea({
  label,
  placeholder,
  value,
  onChange,
  status,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  status: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[11px] font-medium text-zinc-700">{label}</label>
        {status}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={1}
        className="w-full text-[12px] rounded-lg bg-zinc-50 border border-zinc-200 px-2 py-1 resize-none focus:border-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-fuchsia-100"
      />
    </div>
  );
}
