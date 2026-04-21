import { createServerSupabase } from '@/lib/supabase/server';
import { KnowledgeTabs } from '@/components/dashboard/knowledge-tabs';
import { QUESTIONS } from '@/lib/onboarding/questions';
import { BookOpen, FileText, Plug, Sparkles } from 'lucide-react';

type Chunk = { id: string; content: string; category: string; source: string; created_at: string };
type OnbResp = { question_key: string; answer: unknown };

export default async function KnowledgePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, business_type, chat_system_prompt, welcome_message, website')
    .eq('user_id', user!.id).single();
  if (!tenant) return <div>No tenant</div>;

  const { data: chunks } = await supabase
    .from('knowledge_chunks')
    .select('id, content, category, source, created_at')
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(200);

  const { data: onbResponses } = await supabase
    .from('onboarding_responses')
    .select('question_key, answer')
    .eq('tenant_id', tenant.id);

  const allChunks = (chunks || []) as Chunk[];
  const cats = Array.from(new Set(allChunks.map(c => c.category))).sort();
  const docsCount = allChunks.filter(c => c.source && c.source !== 'onboarding' && c.source !== 'manual').length;

  const verticalQuestions = QUESTIONS[tenant.business_type] ?? QUESTIONS.dental ?? [];
  const responsesMap: Record<string, unknown> = {};
  for (const r of (onbResponses || []) as OnbResp[]) {
    responsesMap[r.question_key] = r.answer;
  }

  const stats = [
    {
      label: 'Fragmentos', value: allChunks.length,
      icon: BookOpen, tint: 'bg-[hsl(var(--brand-blue-soft))] text-[hsl(var(--brand-blue))]',
      desc: `En ${cats.length} categorías`,
    },
    {
      label: 'Documentos', value: docsCount,
      icon: FileText, tint: 'bg-amber-50 text-amber-600',
      desc: 'Archivos procesados',
    },
    {
      label: 'APIs conectadas', value: 0,
      icon: Plug, tint: 'bg-violet-50 text-violet-600',
      desc: 'Integraciones activas',
    },
    {
      label: 'Completitud', value: `${Math.round((Object.keys(responsesMap).length / Math.max(verticalQuestions.length, 1)) * 100)}%`,
      icon: Sparkles, tint: 'bg-emerald-50 text-emerald-600',
      desc: 'Preguntas onboarding',
    },
  ];

  return (
    <div className="space-y-4">
      <header className="animate-element">
        <p className="text-sm text-zinc-500">
          Configura el cerebro de tu agente: preguntas, documentos, APIs y prompts.
        </p>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-element animate-delay-100">
        {stats.map((s) => (
          <div key={s.label} className="glass-card p-4">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center ${s.tint}`}>
              <s.icon className="w-4 h-4" />
            </span>
            <p className="mt-3 text-2xl font-semibold text-zinc-900 tabular-nums">{s.value}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
            <p className="text-[10.5px] text-zinc-400 mt-0.5">{s.desc}</p>
          </div>
        ))}
      </section>

      <KnowledgeTabs
        tenantId={tenant.id}
        tenantName={tenant.name ?? ''}
        businessType={tenant.business_type}
        chunks={allChunks}
        categories={cats}
        questions={verticalQuestions}
        responses={responsesMap}
        initialPrompt={tenant.chat_system_prompt ?? ''}
        initialWelcome={tenant.welcome_message ?? ''}
        website={tenant.website ?? ''}
      />
    </div>
  );
}
