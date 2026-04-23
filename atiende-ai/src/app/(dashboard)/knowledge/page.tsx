import { createServerSupabase } from '@/lib/supabase/server';
import { QUESTIONS } from '@/lib/onboarding/questions';
import { KnowledgeZones } from '@/components/dashboard/knowledge-zones';
import { KnowledgeAdvanced } from '@/components/dashboard/knowledge-advanced';
import { ConversationReviewWidget } from '@/components/dashboard/conversation-review-widget';
import { BotPreviewLauncher } from '@/components/dashboard/bot-preview-launcher';
import { PersonalityCard } from '@/components/dashboard/personality-card';

type Chunk = { id: string; content: string; category: string; source: string; created_at: string };
type OnbResp = { question_key: string; answer: unknown };

export default async function KnowledgePage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, business_type, chat_system_prompt, welcome_message')
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
  const cats = Array.from(new Set(allChunks.map((c) => c.category))).sort();

  const verticalQuestions = QUESTIONS[tenant.business_type] ?? QUESTIONS.dental ?? [];
  const responsesMap: Record<string, unknown> = {};
  for (const r of (onbResponses || []) as OnbResp[]) {
    responsesMap[r.question_key] = r.answer;
  }

  const personalityInitial = {
    tone: asString(responsesMap.personality_tone),
    emojis: asString(responsesMap.personality_emojis),
    greeting: asString(responsesMap.personality_greeting),
    closing: asString(responsesMap.personality_closing),
    phrases: asString(responsesMap.personality_phrases),
    avoid: asString(responsesMap.personality_avoid),
  };

  return (
    <div className="w-full h-[calc(100dvh-64px)] flex flex-col overflow-hidden">
      <KnowledgeZones
        verticalQuestions={verticalQuestions}
        initialResponses={responsesMap}
        personalityInitial={personalityInitial}
        advancedProps={{
          tenantId: tenant.id,
          chunks: allChunks,
          categories: cats,
          initialPrompt: tenant.chat_system_prompt ?? '',
          initialWelcome: tenant.welcome_message ?? '',
        }}
      />
    </div>
  );
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
