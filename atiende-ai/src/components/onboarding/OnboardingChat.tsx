'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { TypewriterMessage } from './TypewriterMessage';
import { ChannelSelector } from './ChannelSelector';
import { ChatInput } from './ChatInput';
import { ProgressIndicator } from './ProgressIndicator';
import { InsightCard } from './InsightCard';
import { GenerationAnimation } from './GenerationAnimation';
import type { VerticalEnum } from '@/lib/verticals/types';

type MessageRole = 'ai' | 'user';
type Phase = 'channel' | 'detect' | 'questions' | 'generating' | 'done';

interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  insight?: string;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export function OnboardingChat() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('channel');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [channel, setChannel] = useState<'web' | 'whatsapp' | null>(null);
  const [vertical, setVertical] = useState<VerticalEnum | null>(null);
  const [verticalName, setVerticalName] = useState('');
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [collectedCount, setCollectedCount] = useState(0);
  const [businessName, setBusinessName] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [typingDone, setTypingDone] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const addAiMessage = useCallback((text: string, insight?: string) => {
    const id = `ai-${Date.now()}-${Math.random()}`;
    setMessages((prev) => [...prev, { id, role: 'ai', text, insight }]);
    setInputDisabled(true); // Disable input during typewriter
    return id;
  }, []);

  const addUserMessage = useCallback((text: string) => {
    const id = `user-${Date.now()}`;
    setMessages((prev) => [...prev, { id, role: 'user', text }]);
  }, []);

  const handleTypingComplete = useCallback((msgId: string) => {
    setTypingDone((prev) => new Set(prev).add(msgId));
    setInputDisabled(false);
  }, []);

  // Phase: Channel Selection
  const handleChannelSelect = useCallback((ch: 'web' | 'whatsapp') => {
    setChannel(ch);
    if (ch === 'whatsapp') {
      addAiMessage('El onboarding por WhatsApp estara disponible pronto. Por ahora, continuemos por web.');
    }
    setPhase('detect');
    setShowInput(true);
    setTimeout(() => {
      addAiMessage('Cuentame sobre tu negocio. Por ejemplo: "Soy dentista en Merida" o "Tengo una taqueria"');
    }, 300);
  }, [addAiMessage]);

  // Call the AI-native chat endpoint. The server uses the vertical's question
  // checklist + metadata as context and returns the next natural message.
  const callChat = useCallback(
    async (vert: VerticalEnum, nextHistory: ChatTurn[], currentAnswers: Record<string, string>) => {
      setInputDisabled(true);
      try {
        const res = await fetch('/api/onboarding/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vertical: vert, history: nextHistory, answers: currentAnswers }),
        });
        const data = await res.json();

        if (!res.ok || !data.message) {
          addAiMessage('Hubo un error. Intenta de nuevo.');
          return;
        }

        addAiMessage(data.message);
        setHistory([...nextHistory, { role: 'assistant', content: data.message }]);
        setAnswers(data.answers || currentAnswers);
        setCollectedCount(data.progress?.collected ?? 0);

        // Capture business name on first collected answer (q1 by convention)
        if (data.answers?.q1 && !businessName) {
          setBusinessName(data.answers.q1);
        }

        if (data.isComplete) {
          setTimeout(() => setPhase('generating'), 1500);
        }
      } catch {
        addAiMessage('Error de conexion. Intenta de nuevo.');
      }
    },
    [addAiMessage, businessName],
  );

  // Phase: Vertical Detection
  const handleDetection = useCallback(
    async (userInput: string) => {
      addUserMessage(userInput);
      setInputDisabled(true);

      try {
        const res = await fetch('/api/onboarding/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: userInput }),
        });

        const data = await res.json();

        if (!data.vertical) {
          addAiMessage('No pude identificar tu tipo de negocio. Intenta ser mas especifico, por ejemplo: "Soy dentista", "Tengo un restaurante", "Mi negocio es un hotel".');
          return;
        }

        setVertical(data.vertical);
        setVerticalName(data.displayName);
        setTotalQuestions(data.totalQuestions);

        if (data.totalQuestions === 0) {
          addAiMessage(`Detecte que tienes un negocio de tipo ${data.displayName}. Este vertical estara disponible pronto.`);
          return;
        }

        // Warm greeting (human tone, no meta text)
        addAiMessage(data.insightMessage);

        // Start the AI conversation with an empty history — the server's
        // system prompt will open with a natural first question.
        setTimeout(() => {
          setPhase('questions');
          callChat(data.vertical, [], {});
        }, 1800);
      } catch {
        addAiMessage('Hubo un error al detectar tu tipo de negocio. Intenta de nuevo.');
      }
    },
    [addAiMessage, addUserMessage, callChat],
  );

  // Phase: Answer (just feeds the user's text into the AI chat)
  const handleAnswer = useCallback(
    async (userInput: string) => {
      if (!vertical) return;
      addUserMessage(userInput);
      const nextHistory: ChatTurn[] = [...history, { role: 'user', content: userInput }];
      await callChat(vertical, nextHistory, answers);
    },
    [vertical, history, answers, addUserMessage, callChat],
  );

  // Handle send based on phase
  const handleSend = useCallback(
    (text: string) => {
      if (phase === 'detect') {
        handleDetection(text);
      } else if (phase === 'questions') {
        handleAnswer(text);
      }
    },
    [phase, handleDetection, handleAnswer],
  );

  // Handle file upload: server extracts text from PDF/image and we feed it
  // into the chat as the user's answer.
  const handleUpload = useCallback(
    async (file: File) => {
      if (phase !== 'questions' || !vertical) return;
      addUserMessage(`📎 Subi un archivo: ${file.name}`);
      setUploading(true);
      setInputDisabled(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        // Use the last AI message as context for the extraction prompt
        const lastAi = [...messages].reverse().find((m) => m.role === 'ai');
        formData.append('question', lastAi?.text || 'informacion del negocio');

        const res = await fetch('/api/onboarding/upload', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();

        if (!data.success) {
          addAiMessage(data.error || 'No pude leer el archivo. ¿Puedes escribir la respuesta?');
          setUploading(false);
          return;
        }

        const preview =
          data.extractedText.length > 260
            ? data.extractedText.slice(0, 260) + '...'
            : data.extractedText;
        addAiMessage(`Perfecto, leí tu ${file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'imagen'}. Encontré esto:\n\n${preview}`);

        setUploading(false);
        await new Promise((r) => setTimeout(r, 800));
        // Feed the extracted text into the AI chat as the user's answer
        const nextHistory: ChatTurn[] = [
          ...history,
          { role: 'user', content: data.extractedText },
        ];
        await callChat(vertical, nextHistory, answers);
      } catch {
        setUploading(false);
        setInputDisabled(false);
        addAiMessage('Hubo un error al procesar el archivo. Intenta de nuevo.');
      }
    },
    [phase, vertical, messages, history, answers, addAiMessage, addUserMessage, callChat],
  );

  // Generation complete
  const handleGenerationComplete = useCallback(async () => {
    // Call generate API
    try {
      await fetch('/api/onboarding/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vertical, answers, businessName }),
      });
    } catch {
      // Non-blocking
    }
    setPhase('done');
  }, [vertical, answers, businessName]);

  return (
    <div className="h-[100dvh] flex flex-col bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
        <h1 className="text-lg font-semibold tracking-tight">atiende.ai</h1>
        {phase === 'questions' && vertical && (
          <ProgressIndicator
            current={collectedCount}
            total={totalQuestions}
            verticalName={verticalName}
          />
        )}
      </header>

      {/* Chat area */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-2xl mx-auto flex flex-col gap-4">
          {/* Welcome message */}
          <div className="text-center mb-6 animate-element animate-delay-100">
            <h2 className="text-3xl font-light tracking-tighter mb-2">
              Bienvenido a <span className="font-semibold">atiende.ai</span>
            </h2>
            <p className="text-muted-foreground text-sm">Configura tu agente AI en minutos</p>
          </div>

          {/* Channel selector */}
          {phase === 'channel' && <ChannelSelector onSelect={handleChannelSelect} />}

          {/* Messages */}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
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

          {/* Insight cards */}
          {messages.filter((m) => m.insight && typingDone.has(m.id)).map((msg) => (
            <div key={`insight-${msg.id}`} className="flex justify-start">
              <InsightCard text={msg.insight!} />
            </div>
          ))}

          {/* Generation animation */}
          {phase === 'generating' && (
            <GenerationAnimation
              businessName={businessName || 'Tu negocio'}
              verticalName={verticalName}
              onComplete={handleGenerationComplete}
            />
          )}

          {/* Done state */}
          {phase === 'done' && (
            <div className="text-center py-8 animate-element animate-delay-100">
              <div className="text-5xl mb-4">🎉</div>
              <h3 className="text-2xl font-semibold mb-2">Tu agente esta listo!</h3>
              <p className="text-muted-foreground mb-6">
                Asistente de {businessName || verticalName} configurado con {Object.keys(answers).length} respuestas.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => router.push('/home')}
                  className="px-6 py-3 rounded-2xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 transition-colors"
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
            onUpload={phase === 'questions' ? handleUpload : undefined}
            acceptsUpload={phase === 'questions'}
            uploading={uploading}
            disabled={inputDisabled}
            placeholder={
              phase === 'detect'
                ? 'Ej: "Soy dentista en Merida" o "Tengo una taqueria"...'
                : 'Escribe tu respuesta o sube un PDF / foto...'
            }
          />
        </footer>
      )}

      {/* Footer version */}
      <div className="text-center py-2 text-[10px] text-zinc-300">
        atiende.ai v2.0
      </div>
    </div>
  );
}
