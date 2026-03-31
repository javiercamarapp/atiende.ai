'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { getQuestions, type Question } from '@/lib/onboarding/questions';

export default function Step4() {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string | boolean | string[]>>({});

  useEffect(() => {
    const type = localStorage.getItem('ob_business_type') || 'other';
    setQuestions(getQuestions(type));
  }, []);

  const updateAnswer = (key: string, value: string | boolean | string[]) => {
    setAnswers(prev => ({ ...prev, [key]: value }));
  };

  const allRequiredFilled = questions
    .filter(q => q.required)
    .every(q => {
      const val = answers[q.key];
      if (q.type === 'boolean') return val !== undefined;
      if (q.type === 'multi_select') return Array.isArray(val) && val.length > 0;
      return val !== undefined && val !== '' && String(val).trim().length > 0;
    });

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold">Informacion de tus servicios</h2>
        <p className="text-gray-500 text-sm mt-1">
          Tu bot usara esta info para responder correctamente.
          Entre mas completa, mejor responde.
        </p>
      </div>

      <div className="space-y-5">
        {questions.map(q => (
          <div key={q.key}>
            <Label className="flex items-center gap-1">
              {q.label}
              {q.required && <span className="text-red-500">*</span>}
            </Label>
            {q.help && (
              <p className="text-xs text-blue-600 mt-0.5">{q.help}</p>
            )}

            {q.type === 'text' && (
              <Input
                className="mt-1"
                placeholder={q.placeholder}
                value={String(answers[q.key] ?? '')}
                onChange={e => updateAnswer(q.key, e.target.value)}
              />
            )}

            {q.type === 'textarea' && (
              <Textarea
                className="mt-1"
                rows={4}
                placeholder={q.placeholder}
                value={String(answers[q.key] ?? '')}
                onChange={e => updateAnswer(q.key, e.target.value)}
              />
            )}

            {q.type === 'boolean' && (
              <div className="flex items-center gap-2 mt-1">
                <Switch
                  checked={Boolean(answers[q.key])}
                  onCheckedChange={v => updateAnswer(q.key, v)}
                />
                <span className="text-sm text-gray-600">
                  {answers[q.key] ? 'Si' : 'No'}
                </span>
              </div>
            )}

            {q.type === 'multi_select' && q.options && (
              <div className="grid grid-cols-2 gap-2 mt-1">
                {q.options.map(opt => (
                  <label key={opt} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={Array.isArray(answers[q.key]) && (answers[q.key] as string[]).includes(opt)}
                      onCheckedChange={checked => {
                        const curr = Array.isArray(answers[q.key]) ? (answers[q.key] as string[]) : [];
                        updateAnswer(q.key,
                          checked
                            ? [...curr, opt]
                            : curr.filter((o: string) => o !== opt)
                        );
                      }}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            )}

            {q.type === 'number' && (
              <Input
                type="number" className="mt-1"
                placeholder={q.placeholder}
                value={String(answers[q.key] ?? '')}
                onChange={e => updateAnswer(q.key, e.target.value)}
              />
            )}

            {/* Follow-up si es boolean y es true */}
            {q.type === 'boolean' && q.followUp && answers[q.key] && (
              <Input
                className="mt-2"
                placeholder={q.followUp}
                value={String(answers[`${q.key}_detail`] ?? '')}
                onChange={e => updateAnswer(`${q.key}_detail`, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      <Button
        className="w-full mt-6" size="lg"
        disabled={!allRequiredFilled}
        onClick={() => {
          localStorage.setItem('ob_answers', JSON.stringify(answers));
          router.push('/onboarding/step-5');
        }}
      >
        Siguiente →
      </Button>
    </div>
  );
}
