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

export function OnboardingChat() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('channel');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [channel, setChannel] = useState<'web' | 'whatsapp' | null>(null);
  const [vertical, setVertical] = useState<VerticalEnum | null>(null);
  const [verticalName, setVerticalName] = useState('');
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [businessName, setBusinessName] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [inputDisabled, setInputDisabled] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [typingDone, setTypingDone] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingTypingResolvers = useRef<Map<string, () => void>>(new Map());

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const addAiMessage = useCallback((text: string, insight?: string): Promise<void> => {
    const id = `ai-${Date.now()}-${Math.random()}`;
    setMessages((prev) => [...prev, { id, role: 'ai', text, insight }]);
    setInputDisabled(true); // Disable input during typewriter
    return new Promise((resolve) => {
      pendingTypingResolvers.current.set(id, resolve);
    });
  }, []);

  const addUserMessage = useCallback((text: string) => {
    const id = `user-${Date.now()}`;
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

  // Fetch next question from API
  const fetchQuestion = useCallback(async (vert: VerticalEnum, qNum: number, bName?: string) => {
    try {
      const res = await fetch('/api/onboarding/question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vertical: vert, questionNumber: qNum, businessName: bName }),
      });
      const data = await res.json();
      if (data.text) {
        await addAiMessage(`Pregunta ${data.questionNumber}/${data.totalQuestions}: ${data.text}`);
      }
    } catch {
      await addAiMessage('Error al cargar la pregunta. Intenta de nuevo.');
    }
  }, [addAiMessage]);

  // Phase: Vertical Detection
  const handleDetection = useCallback(async (userInput: string) => {
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
        await addAiMessage('No pude identificar tu tipo de negocio. Intenta ser mas especifico, por ejemplo: "Soy dentista", "Tengo un restaurante", "Mi negocio es un hotel".');
        return;
      }

      setVertical(data.vertical);
      setVerticalName(data.displayName);
      setTotalQuestions(data.totalQuestions);

      if (data.totalQuestions === 0) {
        await addAiMessage(`Detecte que tienes un negocio de tipo ${data.displayName}. Este vertical estara disponible pronto. Estamos trabajando en las preguntas especificas para tu industria.`);
        return;
      }

      // Show detection insight, then config message, then first question — one bubble at a time
      await addAiMessage(data.insightMessage);
      await new Promise((r) => setTimeout(r, 400));
      await addAiMessage(`Vamos a configurar tu agente. Son ${data.totalQuestions} preguntas rapidas.`);
      await new Promise((r) => setTimeout(r, 500));

      setPhase('questions');
      setCurrentQuestion(1);
      await fetchQuestion(data.vertical, 1);
    } catch {
      await addAiMessage('Hubo un error al detectar tu tipo de negocio. Intenta de nuevo.');
    }
  }, [addAiMessage, addUserMessage, fetchQuestion]);

  // Phase: Answer a question
  const handleAnswer = useCallback(async (userInput: string) => {
    if (!vertical) return;

    addUserMessage(userInput);
    setInputDisabled(true);

    // Store answer
    const key = `q${currentQuestion}`;
    const newAnswers = { ...answers, [key]: userInput };
    setAnswers(newAnswers);

    // Extract business name from Q1
    let bName = businessName;
    if (currentQuestion === 1) {
      bName = userInput;
      setBusinessName(userInput);
    }

    // Validate answer
    try {
      const res = await fetch('/api/onboarding/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical,
          questionNumber: currentQuestion,
          answer: userInput,
        }),
      });
      const data = await res.json();

      if (!data.isValid) {
        await addAiMessage(data.errorMessage || 'Respuesta no valida. Intenta de nuevo.');
        return;
      }

      // Show insight if any
      if (data.insight) {
        await addAiMessage(data.insight);
        await new Promise((r) => setTimeout(r, 500));
      }

      // Check if last question
      if (currentQuestion >= totalQuestions) {
        setPhase('generating');
        return;
      }

      // Next question
      const next = currentQuestion + 1;
      setCurrentQuestion(next);
      await fetchQuestion(vertical, next, bName);
    } catch {
      await addAiMessage('Error al procesar tu respuesta. Intenta de nuevo.');
    }
  }, [vertical, currentQuestion, totalQuestions, answers, businessName, addAiMessage, addUserMessage, fetchQuestion]);

  // Handle send based on phase
  const handleSend = useCallback((text: string) => {
    if (phase === 'detect') {
      handleDetection(text);
    } else if (phase === 'questions') {
      handleAnswer(text);
    }
  }, [phase, handleDetection, handleAnswer]);

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
          <ProgressIndicator current={currentQuestion} total={totalQuestions} verticalName={verticalName} />
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
            placeholder={
              phase === 'detect'
                ? 'Ej: "Soy dentista en Merida" o "Tengo una taqueria"...'
                : 'Escribe tu respuesta...'
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
