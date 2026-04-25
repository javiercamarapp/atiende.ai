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
type Phase = 'channel' | 'conversation' | 'generating' | 'done';

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
// Two opening bubbles: Valeria introduces herself, then asks the first
// question. Rendered sequentially via addAiMessage so the user sees them as
// separate chat bubbles (Valeria's persona is the agent defined in
// src/lib/onboarding/chat-agent.ts).
const INITIAL_AI_MESSAGES: readonly string[] = [
  '¡Hola! Soy Valeria, de useatiende.ai. Voy a ayudarte a configurar tu agente de inteligencia artificial para que atienda tu negocio —consultorio, clínica, salón o spa— 24/7 por WhatsApp, sin que pierdas una sola cita.',
  'Para empezar, cuéntame de tu negocio en una frase (ej: "soy dentista en Mérida"). Si prefieres, pégame el link de tu sitio web o adjunta fotos o PDFs de tu menú, lista de precios o cédula — los leo y extraigo lo que pueda.',
];

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
  const [isThinking, setIsThinking] = useState(false);
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
  }, [messages, isThinking, scrollToBottom]);

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
      // Bot name capturado por el agente conversacional como bot_name (ver
      // chat-agent.ts regla 10). Caemos a 'Sofía' si quedó vacío.
      const agentBotName =
        currentFields.bot_name ||
        currentFields.botName ||
        currentFields.q_botname ||
        '';

      const res = await fetch('/api/onboarding/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical: currentVertical,
          answers: currentFields,
          businessName: bName,
          botName: agentBotName,
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
    setPhase('done');
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

      setIsThinking(true);
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
          setIsThinking(false);
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

        setIsThinking(false);
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
        setIsThinking(false);
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
        ).then(async () => {
          for (const msg of INITIAL_AI_MESSAGES) {
            await addAiMessage(msg);
            historyRef.current.push({ role: 'assistant', content: msg });
          }
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
        (async () => {
          for (const msg of INITIAL_AI_MESSAGES) {
            await addAiMessage(msg);
            historyRef.current.push({ role: 'assistant', content: msg });
          }
        })();
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
        <Image
          src="/logo.png"
          alt="atiende.ai"
          width={472}
          height={200}
          priority
          style={{ height: '32px', width: 'auto' }}
          className="shrink-0"
        />
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
              Bienvenido a <span className="font-semibold text-[hsl(var(--brand-blue))]">useatiende.ai</span>
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

          {/* Thinking indicator — shown while the onboarding AI is processing
              a user turn (upload + chat API). Cleared as soon as the first
              assistant message is added to the queue. */}
          {isThinking && (
            <div className="flex justify-start">
              <div className="max-w-lg px-4 py-3 rounded-2xl text-sm bg-zinc-50 text-zinc-500 border border-zinc-100 rounded-bl-md inline-flex items-center gap-2">
                <span>pensando</span>
                <span className="inline-flex items-end gap-1">
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}

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

          {/* Done state */}
          {phase === 'done' && (
            <div className="text-center py-8 animate-element animate-delay-100">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="text-2xl font-semibold mb-2">¡Tu agente está listo!</h3>
              <p className="text-muted-foreground mb-6">
                Asistente de {businessName || verticalDisplayName} configurado con{' '}
                {Object.keys(capturedFields).length} datos.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={() => router.push('/onboarding/connect')}
                  className="px-6 py-3 rounded-2xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-colors"
                >
                  Conectar WhatsApp
                </button>
                <button
                  onClick={() => router.push('/preview')}
                  className="px-6 py-3 rounded-2xl border border-zinc-200 text-zinc-900 font-medium hover:bg-zinc-50 transition-colors"
                >
                  Ver preview
                </button>
              </div>
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
      <div className="text-center py-2 text-[10px] text-zinc-300">useatiende.ai v2.0</div>
    </div>
  );
}
