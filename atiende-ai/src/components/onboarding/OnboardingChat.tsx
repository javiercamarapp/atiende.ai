'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { TypewriterMessage } from './TypewriterMessage';
import { ChannelSelector } from './ChannelSelector';
import { ChatInput } from './ChatInput';
import { ProgressIndicator } from './ProgressIndicator';
import type { VerticalEnum } from '@/lib/verticals/types';

type MessageRole = 'ai' | 'user';
type Phase = 'channel' | 'conversation' | 'generating' | 'preview' | 'done';

interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
}

interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface PersistedState {
  version: 2;
  vertical: VerticalEnum | null;
  capturedFields: Record<string, string>;
  history: HistoryTurn[];
  totalRequired: number;
  capturedRequired: number;
  done: boolean;
}

const STORAGE_KEY = 'atiende_onboarding_v2';
const INITIAL_AI_MESSAGE =
  '¡Hola! Cuéntame de tu negocio en una frase (ej: "soy dentista en Mérida"). Si prefieres, pégame el link de tu sitio web o adjunta fotos o PDFs de tu menú, lista de precios o cédula — los leo y extraigo lo que pueda.';

function loadPersistedState(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 2) return null;
    return parsed as PersistedState;
  } catch {
    return null;
  }
}

function savePersistedState(state: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage quota or privacy mode — non-fatal.
  }
}

function clearPersistedState(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

export function OnboardingChat() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('channel');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [vertical, setVertical] = useState<VerticalEnum | null>(null);
  const [capturedFields, setCapturedFields] = useState<Record<string, string>>({});
  const [historyRef] = useState<{ current: HistoryTurn[] }>({ current: [] });
  const [totalRequired, setTotalRequired] = useState(0);
  const [capturedRequired, setCapturedRequired] = useState(0);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [typingDone, setTypingDone] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingTypingResolvers = useRef<Map<string, () => void>>(new Map());
  const hydratedRef = useRef(false);
  const isProcessingRef = useRef(false);
  const pendingQueueRef = useRef<{ text: string; files: File[] }[]>([]);
  // Refs that always hold the latest values — used by handleGenerationComplete
  // to avoid stale closures when the callback fires after the animation delay.
  const verticalRef = useRef<VerticalEnum | null>(null);
  const capturedFieldsRef = useRef<Record<string, string>>({});

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Keep refs in sync with state so async callbacks always read latest.
  useEffect(() => {
    verticalRef.current = vertical;
  }, [vertical]);
  useEffect(() => {
    capturedFieldsRef.current = capturedFields;
  }, [capturedFields]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ── Message helpers ──
  const addAiMessage = useCallback((text: string): Promise<void> => {
    const id = `ai-${Date.now()}-${Math.random()}`;
    setMessages((prev) => [...prev, { id, role: 'ai', text }]);
    setInputDisabled(true); // Disabled while typewriter runs.
    return new Promise((resolve) => {
      pendingTypingResolvers.current.set(id, resolve);
    });
  }, []);

  const addAiMessageSilent = useCallback((text: string) => {
    // Used when rehydrating from localStorage — skip typewriter and mark done.
    const id = `ai-silent-${Date.now()}-${Math.random()}`;
    setMessages((prev) => [...prev, { id, role: 'ai', text }]);
    setTypingDone((prev) => new Set(prev).add(id));
  }, []);

  const addUserMessage = useCallback((text: string) => {
    const id = `user-${Date.now()}-${Math.random()}`;
    setMessages((prev) => [...prev, { id, role: 'user', text }]);
  }, []);

  const handleTypingComplete = useCallback((msgId: string) => {
    setTypingDone((prev) => new Set(prev).add(msgId));
    setInputDisabled(false);
    const resolver = pendingTypingResolvers.current.get(msgId);
    if (resolver) {
      pendingTypingResolvers.current.delete(msgId);
      resolver();
    }
  }, []);

  // ── Persistence helper ──
  const persist = useCallback(
    (next: Partial<PersistedState>) => {
      const base: PersistedState = {
        version: 2,
        vertical,
        capturedFields,
        history: historyRef.current,
        totalRequired,
        capturedRequired,
        done: false,
      };
      savePersistedState({ ...base, ...next });
    },
    [vertical, capturedFields, totalRequired, capturedRequired, historyRef],
  );

  // ── Generation step (when done) ──
  // Declared BEFORE processOneItem because processOneItem calls it directly
  // when the agent signals done=true (no animation callback indirection).
  const [generateError, setGenerateError] = useState<string | null>(null);

  const handleGenerationComplete = useCallback(async () => {
    setGenerateError(null);
    try {
      const currentVertical = verticalRef.current;
      const currentFields = capturedFieldsRef.current;
      const bName = currentFields.q1 || currentVertical || 'Mi negocio';

      const res = await fetch('/api/onboarding/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical: currentVertical,
          answers: currentFields,
          businessName: bName,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setGenerateError(
          body.error === 'Unauthorized'
            ? 'Parece que tu sesión expiró. Inicia sesión de nuevo e intenta otra vez.'
            : `No pudimos guardar tu configuración (${body.error || res.status}). Intenta de nuevo.`,
        );
        return;
      }
    } catch (err) {
      console.error('[onboarding] generate failed:', err);
      setGenerateError(
        'Error de red al guardar tu configuración. Revisa tu conexión e intenta de nuevo.',
      );
      return;
    }
    clearPersistedState();
    setPhase('preview');
  }, []);

  const retryGeneration = useCallback(() => {
    setGenerateError(null);
    handleGenerationComplete();
  }, [handleGenerationComplete]);

  // ── Upload helper: POST a single file to /api/onboarding/upload ──
  const uploadFile = useCallback(
    async (
      file: File,
    ): Promise<{ filename: string; markdown: string } | { error: string }> => {
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/onboarding/upload', {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return {
            error:
              body.message ||
              body.error ||
              `No pude leer ${file.name}. Intenta con otra imagen.`,
          };
        }
        const body = await res.json();
        return { filename: body.filename, markdown: body.markdown };
      } catch {
        return { error: `Error de red al subir ${file.name}.` };
      }
    },
    [],
  );

  // ── Process a single queued item (upload files, call chat API, render AI) ──
  const processOneItem = useCallback(
    async (item: { text: string; files: File[] }) => {
      const { text: userText, files } = item;

      // Upload all attached files in parallel.
      const uploadedContent: { filename: string; markdown: string }[] = [];
      if (files.length > 0) {
        const uploadResults = await Promise.all(files.map((f) => uploadFile(f)));
        const errors: string[] = [];
        for (const r of uploadResults) {
          if ('error' in r) errors.push(r.error);
          else uploadedContent.push({ filename: r.filename, markdown: r.markdown });
        }
        if (errors.length > 0) {
          await addAiMessage(errors.join(' '));
          if (uploadedContent.length === 0) return;
        }
      }

      // Append user turn to history.
      historyRef.current = [
        ...historyRef.current,
        { role: 'user', content: userText },
      ];

      try {
        const res = await fetch('/api/onboarding/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vertical,
            capturedFields,
            history: historyRef.current.slice(0, -1),
            userMessage: userText,
            uploadedContent: uploadedContent.length > 0 ? uploadedContent : undefined,
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const fallbackList: string[] = Array.isArray(errBody.assistantMessages)
            ? errBody.assistantMessages
            : [
                errBody.assistantMessage ||
                  'Hubo un problema procesando tu mensaje. Inténtalo otra vez.',
              ];
          for (const msg of fallbackList) {
            await addAiMessage(msg);
          }
          return;
        }

        const data: {
          vertical: VerticalEnum | null;
          capturedFields: Record<string, string>;
          assistantMessages: string[];
          done: boolean;
          totalRequired: number;
          capturedRequired: number;
        } = await res.json();

        if (data.vertical) setVertical(data.vertical);
        setCapturedFields(data.capturedFields);
        setTotalRequired(data.totalRequired);
        setCapturedRequired(data.capturedRequired);

        const messagesToRender = data.assistantMessages.filter(
          (m) => typeof m === 'string' && m.trim().length > 0,
        );
        historyRef.current = [
          ...historyRef.current,
          ...messagesToRender.map((content) => ({
            role: 'assistant' as const,
            content,
          })),
        ];

        savePersistedState({
          version: 2,
          vertical: data.vertical ?? vertical,
          capturedFields: data.capturedFields,
          history: historyRef.current,
          totalRequired: data.totalRequired,
          capturedRequired: data.capturedRequired,
          done: data.done,
        });

        for (let i = 0; i < messagesToRender.length; i++) {
          if (i > 0) await new Promise((r) => setTimeout(r, 450));
          await addAiMessage(messagesToRender[i]);
        }

        if (data.done) {
          // Skip animation — call generate API immediately to avoid the
          // GenerationAnimation component, which may be causing the
          // "Algo salió mal" error boundary crash.
          setPhase('generating');
          await handleGenerationComplete();
        }
      } catch (err) {
        console.error('[onboarding] processOneItem error:', err);
        await addAiMessage('Error de red. Revisa tu conexión e intenta de nuevo.');
      }
    },
    [vertical, capturedFields, historyRef, addAiMessage, uploadFile, handleGenerationComplete],
  );

  // ── Queue-based turn handler — input stays unlocked ──
  // The user can type and send multiple messages while the AI is still
  // processing/typing a previous one. Each message gets rendered
  // immediately as a user bubble; the queue drains sequentially so the
  // AI responds to each in order, like a real chat.
  const handleTurn = useCallback(
    (userText: string, files: File[] = []) => {
      // Render the user message immediately (no locking the input).
      const userDisplay =
        files.length > 0
          ? `${userText}\n\n📎 ${files.length} archivo${files.length === 1 ? '' : 's'}: ${files.map((f) => f.name).join(', ')}`
          : userText;
      addUserMessage(userDisplay);

      // Push to queue.
      pendingQueueRef.current.push({ text: userText, files });

      // If the processing loop is already running, it will pick this up.
      if (isProcessingRef.current) return;

      // Start the drain loop — wrapped in try/catch so no unhandled rejection
      // escapes to Next.js's root error boundary.
      isProcessingRef.current = true;
      (async () => {
        try {
          while (pendingQueueRef.current.length > 0) {
            const next = pendingQueueRef.current.shift()!;
            await processOneItem(next);
          }
        } catch (err) {
          console.error('[onboarding] queue drain error:', err);
        }
        isProcessingRef.current = false;
      })();
    },
    [addUserMessage, processOneItem],
  );

  // ── Channel selection ──
  const handleChannelSelect = useCallback(
    (ch: 'web' | 'whatsapp') => {
      setPhase('conversation');
      setShowInput(true);

      if (ch === 'whatsapp') {
        // WhatsApp onboarding not implemented yet; announce and fall back to web.
        addAiMessage(
          'El onboarding por WhatsApp estará disponible pronto. Por ahora continuamos por web.',
        ).then(() => {
          addAiMessage(INITIAL_AI_MESSAGE).then(() => {
            historyRef.current.push({ role: 'assistant', content: INITIAL_AI_MESSAGE });
          });
        });
        return;
      }

      // Web channel → try to rehydrate, else show initial prompt.
      const persisted = loadPersistedState();
      if (persisted && !persisted.done && persisted.history.length > 0) {
        hydratedRef.current = true;
        setVertical(persisted.vertical);
        setCapturedFields(persisted.capturedFields);
        setTotalRequired(persisted.totalRequired);
        setCapturedRequired(persisted.capturedRequired);
        historyRef.current = persisted.history;
        // Replay history as silent messages.
        for (const turn of persisted.history) {
          if (turn.role === 'user') {
            addUserMessage(turn.content);
          } else {
            addAiMessageSilent(turn.content);
          }
        }
        setShowInput(true);
      } else {
        addAiMessage(INITIAL_AI_MESSAGE).then(() => {
          historyRef.current.push({ role: 'assistant', content: INITIAL_AI_MESSAGE });
        });
      }
    },
    [addAiMessage, addAiMessageSilent, addUserMessage, historyRef],
  );

  // ── Send handler ──
  const handleSend = useCallback(
    (text: string, files: File[] = []) => {
      if (phase === 'conversation') {
        handleTurn(text, files);
      }
    },
    [phase, handleTurn],
  );

  const businessName = capturedFields.q1 ?? '';
  const verticalDisplayName = vertical ?? '';

  // Suppress unused-warning on persist — it's retained for future inline uses
  // (e.g., when we want to persist after a partial UI mutation outside handleTurn).
  void persist;

  return (
    <div className="h-[100dvh] flex flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
        <Image src="/Add a heading.png" alt="atiende.ai" width={140} height={38} className="h-8 w-auto" priority />
        {phase === 'conversation' && vertical && totalRequired > 0 && (
          <ProgressIndicator
            current={capturedRequired}
            total={totalRequired}
            verticalName={verticalDisplayName}
          />
        )}
      </header>

      {/* Chat area */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {/* Welcome header */}
          <div className="text-center mb-6 animate-element animate-delay-100">
            <h2 className="text-3xl font-light tracking-tighter mb-2">
              Bienvenido a <span className="font-semibold">atiende.ai</span>
            </h2>
            <p className="text-muted-foreground text-sm">
              Configura tu agente AI en minutos
            </p>
          </div>

          {/* Channel selector */}
          {phase === 'channel' && <ChannelSelector onSelect={handleChannelSelect} />}

          {/* Messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-lg px-4 py-3 rounded-2xl text-sm ${
                  msg.role === 'user'
                    ? 'bg-zinc-900 text-white rounded-br-md'
                    : 'bg-zinc-50 text-zinc-900 border border-zinc-100 rounded-bl-md'
                }`}
              >
                {msg.role === 'ai' && !typingDone.has(msg.id) ? (
                  <TypewriterMessage
                    text={msg.text}
                    speed={15}
                    onComplete={() => handleTypingComplete(msg.id)}
                  />
                ) : (
                  <span className="whitespace-pre-wrap">{msg.text}</span>
                )}
              </div>
            </div>
          ))}

          {/* Generation loading — simple spinner while the API call runs.
              We call handleGenerationComplete directly from processOneItem
              instead of relying on GenerationAnimation's onComplete callback
              to eliminate a source of error-boundary crashes. */}
          {phase === 'generating' && !generateError && (
            <div className="text-center py-8 animate-element animate-delay-100">
              <div className="w-10 h-10 border-3 border-zinc-200 border-t-zinc-900 rounded-full animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-semibold">{businessName || 'Tu negocio'}</h3>
              <p className="text-sm text-muted-foreground mt-1">Configurando tu agente...</p>
            </div>
          )}

          {/* Generation error state with retry */}
          {phase === 'generating' && generateError && (
            <div className="text-center py-8 animate-element animate-delay-100">
              <div className="text-5xl mb-4">⚠️</div>
              <h3 className="text-xl font-semibold mb-2">
                No pudimos guardar tu configuración
              </h3>
              <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
                {generateError}
              </p>
              <button
                onClick={retryGeneration}
                className="px-6 py-3 rounded-2xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-colors"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Preview state — test bot + connect WhatsApp */}
          {phase === 'preview' && (
            <div className="py-6 animate-element animate-delay-100 space-y-6 max-w-lg mx-auto">
              <div className="text-center">
                <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-2xl font-semibold text-zinc-900 mb-1">
                  ¡Tu agente está listo!
                </h3>
                <p className="text-sm text-zinc-500">
                  {businessName || verticalDisplayName} — {Object.keys(capturedFields).length} datos configurados
                </p>
              </div>

              {/* Option 1: Test the bot */}
              <button
                onClick={() => router.push('/playground')}
                className="w-full p-5 rounded-2xl border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-zinc-200 transition-colors">
                    <svg className="w-5 h-5 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">Probar mi agente</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Chatea con tu bot y ve cómo responde antes de conectarlo</p>
                  </div>
                  <svg className="w-4 h-4 text-zinc-400 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Option 2: Connect WhatsApp */}
              <button
                onClick={() => router.push('/settings/agent')}
                className="w-full p-5 rounded-2xl border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center shrink-0 group-hover:bg-zinc-200 transition-colors">
                    <svg className="w-5 h-5 text-zinc-600" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                      <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.955 9.955 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.96 7.96 0 01-4.106-1.138l-.294-.176-2.862.85.85-2.862-.176-.294A7.96 7.96 0 014 12c0-4.411 3.589-8 8-8s8 3.589 8 8-3.589 8-8 8z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-900">Conectar WhatsApp</p>
                    <p className="text-xs text-zinc-500 mt-0.5">Vincula tu número de WhatsApp Business para empezar a recibir clientes</p>
                  </div>
                  <svg className="w-4 h-4 text-zinc-400 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Option 3: Go to dashboard */}
              <button
                onClick={() => {
                  setPhase('done');
                  router.push('/home');
                }}
                className="w-full py-3 text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
              >
                Ir al dashboard directamente
              </button>
            </div>
          )}

          {/* Done state (redirect) */}
          {phase === 'done' && (
            <div className="text-center py-8 animate-element animate-delay-100">
              <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin mx-auto" />
              <p className="text-sm text-zinc-500 mt-3">Cargando dashboard...</p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input */}
      {showInput && phase !== 'generating' && phase !== 'done' && phase !== 'channel' && (
        <footer className="border-t border-zinc-100 py-4">
          <ChatInput
            onSend={handleSend}
            disabled={inputDisabled}
            placeholder="Escribe o pega tu URL…"
          />
        </footer>
      )}

      {/* Footer version */}
      <div className="text-center py-2 text-[10px] text-zinc-300">atiende.ai v2.0</div>
    </div>
  );
}
