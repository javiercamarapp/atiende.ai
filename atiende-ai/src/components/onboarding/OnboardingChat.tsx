'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TypewriterMessage } from './TypewriterMessage';
import { ChannelSelector } from './ChannelSelector';
import { ChatInput } from './ChatInput';
import { ProgressIndicator } from './ProgressIndicator';
import { GenerationAnimation } from './GenerationAnimation';
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
const INITIAL_AI_MESSAGE =
  '¡Hola! Cuéntame de tu negocio en una frase (ej: "soy dentista en Mérida"), o si prefieres pégame el link de tu sitio web y extraigo lo que pueda.';

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

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

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

  // ── Unified turn handler ──
  const handleTurn = useCallback(
    async (userText: string) => {
      addUserMessage(userText);
      setInputDisabled(true);

      // Append to history before sending (so the server sees it).
      const nextHistory: HistoryTurn[] = [
        ...historyRef.current,
        { role: 'user', content: userText },
      ];
      historyRef.current = nextHistory;

      try {
        const res = await fetch('/api/onboarding/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            vertical,
            capturedFields,
            history: nextHistory.slice(0, -1), // server appends userMessage itself
            userMessage: userText,
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          const fallback =
            errBody.assistantMessage ||
            'Hubo un problema procesando tu mensaje. Inténtalo otra vez.';
          await addAiMessage(fallback);
          return;
        }

        const data: {
          vertical: VerticalEnum | null;
          capturedFields: Record<string, string>;
          assistantMessage: string;
          done: boolean;
          totalRequired: number;
          capturedRequired: number;
        } = await res.json();

        // Update state from server response.
        if (data.vertical) setVertical(data.vertical);
        setCapturedFields(data.capturedFields);
        setTotalRequired(data.totalRequired);
        setCapturedRequired(data.capturedRequired);

        // Append assistant turn to history.
        historyRef.current = [
          ...historyRef.current,
          { role: 'assistant', content: data.assistantMessage },
        ];

        // Persist BEFORE showing the message so a refresh mid-typewriter keeps it.
        savePersistedState({
          version: 2,
          vertical: data.vertical ?? vertical,
          capturedFields: data.capturedFields,
          history: historyRef.current,
          totalRequired: data.totalRequired,
          capturedRequired: data.capturedRequired,
          done: data.done,
        });

        await addAiMessage(data.assistantMessage);

        if (data.done) {
          setPhase('generating');
        }
      } catch {
        await addAiMessage('Error de red. Revisa tu conexión e intenta de nuevo.');
      }
    },
    [vertical, capturedFields, historyRef, addAiMessage, addUserMessage],
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
    (text: string) => {
      if (phase === 'conversation') {
        handleTurn(text);
      }
    },
    [phase, handleTurn],
  );

  // ── Generation step (when done) ──
  const handleGenerationComplete = useCallback(async () => {
    try {
      await fetch('/api/onboarding/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical,
          answers: capturedFields,
          businessName: capturedFields.q1 ?? '',
        }),
      });
    } catch {
      // Non-blocking.
    }
    clearPersistedState();
    setPhase('done');
  }, [vertical, capturedFields]);

  const businessName = capturedFields.q1 ?? '';
  const verticalDisplayName = vertical ?? '';

  // Suppress unused-warning on persist — it's retained for future inline uses
  // (e.g., when we want to persist after a partial UI mutation outside handleTurn).
  void persist;

  return (
    <div className="h-[100dvh] flex flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
        <h1 className="text-lg font-semibold tracking-tight">atiende.ai</h1>
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

          {/* Generation animation */}
          {phase === 'generating' && (
            <GenerationAnimation
              businessName={businessName || 'Tu negocio'}
              verticalName={verticalDisplayName}
              onComplete={handleGenerationComplete}
            />
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
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => router.push('/home')}
                  className="px-6 py-3 rounded-2xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 transition-colors"
                >
                  Ir al Dashboard
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
      <div className="text-center py-2 text-[10px] text-zinc-300">atiende.ai v2.0</div>
    </div>
  );
}
