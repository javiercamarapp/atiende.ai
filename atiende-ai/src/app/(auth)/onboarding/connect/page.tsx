'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, MessageCircle, ExternalLink, Loader2, Copy, Check, Sparkles } from 'lucide-react';

type Status = 'idle' | 'saving' | 'saved' | 'error';
type SeedStatus = 'idle' | 'seeding' | 'seeded' | 'error';

export default function ConnectWhatsAppPage() {
  const router = useRouter();
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [seedStatus, setSeedStatus] = useState<SeedStatus>('idle');
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seedResult, setSeedResult] = useState<{ services: number; staff: number; knowledge: number } | null>(null);

  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/webhook/whatsapp`
    : 'https://useatiende.ai/api/webhook/whatsapp';

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneNumberId.trim() || status === 'saving') return;
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/onboarding/connect-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumberId: phoneNumberId.trim() }),
      });
      const json = await res.json();
      if (!res.ok) {
        setStatus('error');
        setError(json?.error || 'No pudimos conectar tu número.');
        return;
      }
      setStatus('saved');
    } catch {
      setStatus('error');
      setError('Error de red. Inténtalo de nuevo.');
    }
  }

  async function handleSeedDemo() {
    if (seedStatus === 'seeding') return;
    setSeedStatus('seeding');
    setSeedError(null);
    try {
      const res = await fetch('/api/onboarding/seed-demo', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) {
        setSeedStatus('error');
        setSeedError(json?.error || 'No pudimos cargar los datos demo.');
        return;
      }
      setSeedResult(json.added);
      setSeedStatus('seeded');
    } catch {
      setSeedStatus('error');
      setSeedError('Error de red. Inténtalo de nuevo.');
    }
  }

  async function copyWebhook() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 1800);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="px-6 py-4 border-b border-zinc-100">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <span className="text-sm font-semibold tracking-tight">useatiende.ai</span>
          <Link
            href="/home"
            className="text-xs text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            Saltar por ahora
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-10">
        <div className="max-w-2xl mx-auto flex flex-col gap-8">
          {/* Hero */}
          <div className="text-center animate-element animate-delay-100">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-900 text-white mb-5">
              <CheckCircle2 className="w-9 h-9" />
            </div>
            <h1 className="text-3xl font-light tracking-tighter mb-2">
              Tu agente está <span className="font-semibold">listo</span>
            </h1>
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Conecta tu WhatsApp Business para que empiece a atender clientes 24/7.
              O prueba primero cómo responde en un chat de preview.
            </p>
          </div>

          {/* Demo seed CTA — fill in realistic services/staff/KB so the preview
              has something to book against without forcing manual config. */}
          <div className="animate-element animate-delay-150">
            <div className="rounded-2xl border border-zinc-200 bg-white p-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">Cargar datos de demo</p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Agrega servicios, staff y horarios realistas de tu giro para probar agendas en el preview.
                  </p>
                  {seedError && <p className="text-xs text-red-600 mt-2">{seedError}</p>}
                  {seedStatus === 'seeded' && seedResult && (
                    <p className="text-xs text-emerald-700 mt-2">
                      Listo — agregamos {seedResult.services} servicios, {seedResult.staff} staff y {seedResult.knowledge} hechos al RAG.
                    </p>
                  )}
                </div>
                <button
                  onClick={handleSeedDemo}
                  disabled={seedStatus === 'seeding' || seedStatus === 'seeded'}
                  className="shrink-0 px-4 py-2 rounded-xl bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {seedStatus === 'seeding' ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Cargando…
                    </>
                  ) : seedStatus === 'seeded' ? (
                    <>
                      <Check className="w-3 h-3" />
                      Listo
                    </>
                  ) : (
                    'Cargar demo'
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Preview CTA */}
          <div className="animate-element animate-delay-200">
            <button
              onClick={() => router.push('/preview')}
              className="w-full group flex items-center gap-4 px-5 py-4 rounded-2xl border border-zinc-200 hover:border-zinc-900 hover:bg-zinc-50 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center shrink-0">
                <MessageCircle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Ver preview del chatbot</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Agenda citas, pregunta precios, prueba el FAQ — todo real, sin WhatsApp.
                </p>
              </div>
              <span className="text-zinc-400 group-hover:text-zinc-900 transition-colors text-sm">→</span>
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 animate-element animate-delay-300">
            <div className="flex-1 h-px bg-zinc-100" />
            <span className="text-[11px] uppercase tracking-wider text-zinc-400">o conecta ya</span>
            <div className="flex-1 h-px bg-zinc-100" />
          </div>

          {/* Connect form */}
          <section className="animate-element animate-delay-400">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6">
              <h2 className="font-semibold text-base mb-1">Conecta tu WhatsApp Business</h2>
              <p className="text-xs text-zinc-500 mb-5">
                Usa el número que tus clientes ya conocen — seguirá siendo tuyo.
              </p>

              <ol className="flex flex-col gap-4 mb-6">
                <li className="flex gap-3 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-zinc-900 text-white text-[11px] flex items-center justify-center font-medium">1</span>
                  <div className="flex-1">
                    <p className="text-zinc-900">
                      Entra a{' '}
                      <a
                        href="https://business.facebook.com/wa/manage/phone-numbers/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-zinc-600 inline-flex items-center gap-1"
                      >
                        Meta Business Suite <ExternalLink className="w-3 h-3" />
                      </a>
                    </p>
                    <p className="text-xs text-zinc-500 mt-0.5">Sección WhatsApp → Números de teléfono.</p>
                  </div>
                </li>
                <li className="flex gap-3 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-zinc-900 text-white text-[11px] flex items-center justify-center font-medium">2</span>
                  <div className="flex-1">
                    <p className="text-zinc-900">Copia el <span className="font-medium">Phone Number ID</span></p>
                    <p className="text-xs text-zinc-500 mt-0.5">Son ~15 dígitos. Aparece bajo el número de tu negocio.</p>
                  </div>
                </li>
                <li className="flex gap-3 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-zinc-900 text-white text-[11px] flex items-center justify-center font-medium">3</span>
                  <div className="flex-1">
                    <p className="text-zinc-900">Configura este webhook en Meta</p>
                    <button
                      type="button"
                      onClick={copyWebhook}
                      className="mt-1.5 w-full inline-flex items-center justify-between gap-2 text-xs font-mono bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 hover:border-zinc-900 transition-colors"
                    >
                      <span className="truncate text-zinc-700">{webhookUrl}</span>
                      {webhookCopied ? (
                        <Check className="w-3.5 h-3.5 text-zinc-900 shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                      )}
                    </button>
                  </div>
                </li>
              </ol>

              <form onSubmit={handleConnect} className="flex flex-col gap-3">
                <label className="text-xs font-medium text-zinc-700">
                  Phone Number ID
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={phoneNumberId}
                  onChange={(e) => setPhoneNumberId(e.target.value.replace(/\D/g, ''))}
                  placeholder="1090268194169659"
                  disabled={status === 'saved' || status === 'saving'}
                  className="w-full px-4 py-3 rounded-2xl border border-zinc-200 font-mono text-sm focus:outline-none focus:border-zinc-900 disabled:bg-zinc-50 disabled:text-zinc-500"
                />
                {error && (
                  <p className="text-xs text-red-600">{error}</p>
                )}
                {status === 'saved' ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-sm text-zinc-900 bg-zinc-50 border border-zinc-200 rounded-2xl px-4 py-3">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Conectado. Tu agente ya está recibiendo mensajes.</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push('/home')}
                      className="w-full px-6 py-3 rounded-2xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-colors"
                    >
                      Ir al dashboard
                    </button>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={!phoneNumberId.trim() || status === 'saving'}
                    className="w-full px-6 py-3 rounded-2xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  >
                    {status === 'saving' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Conectando…
                      </>
                    ) : (
                      'Conectar WhatsApp'
                    )}
                  </button>
                )}
              </form>
            </div>
          </section>

          <p className="text-center text-xs text-zinc-400 animate-element animate-delay-500">
            ¿Problemas con Meta? Saltar por ahora y conectar desde el dashboard cuando tengas el ID.
          </p>
        </div>
      </main>

      <div className="text-center py-2 text-[10px] text-zinc-300">useatiende.ai v2.0</div>
    </div>
  );
}
