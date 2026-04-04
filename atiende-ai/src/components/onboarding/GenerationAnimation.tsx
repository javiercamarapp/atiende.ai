'use client';
import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, Sparkles, Shield, Brain } from 'lucide-react';

interface GenerationAnimationProps {
  businessName: string;
  verticalName: string;
  onComplete?: () => void;
}

const STEPS = [
  { icon: Brain, text: 'Analizando respuestas...', duration: 2000 },
  { icon: Sparkles, text: 'Generando personalidad del agente...', duration: 2000 },
  { icon: Shield, text: 'Configurando reglas anti-alucinacion...', duration: 1500 },
  { icon: CheckCircle2, text: 'Agente listo', duration: 1000 },
];

export function GenerationAnimation({ businessName, verticalName, onComplete }: GenerationAnimationProps) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (currentStep >= STEPS.length) {
      onComplete?.();
      return;
    }

    const timer = setTimeout(() => {
      setCurrentStep((s) => s + 1);
    }, STEPS[currentStep].duration);

    return () => clearTimeout(timer);
  }, [currentStep, onComplete]);

  return (
    <div className="flex flex-col items-center gap-6 py-8 animate-element animate-delay-100">
      <div className="relative w-16 h-16">
        {currentStep < STEPS.length - 1 ? (
          <Loader2 className="w-16 h-16 text-zinc-900 animate-spin" />
        ) : (
          <CheckCircle2 className="w-16 h-16 text-zinc-900 animate-element" />
        )}
      </div>

      <div className="text-center">
        <h3 className="text-lg font-semibold">{businessName}</h3>
        <p className="text-sm text-muted-foreground">{verticalName}</p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          return (
            <div
              key={i}
              className={`flex items-center gap-3 text-sm transition-all duration-300 ${
                isDone ? 'text-zinc-900' : isActive ? 'text-zinc-900' : 'text-zinc-300'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : isActive ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
              ) : (
                <Icon className="w-4 h-4 shrink-0" />
              )}
              <span>{step.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
