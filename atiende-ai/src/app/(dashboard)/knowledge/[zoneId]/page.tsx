import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/lib/supabase/server';
import { QUESTIONS } from '@/lib/onboarding/questions';
import { ZONES, getQuestionsForZone, type ZoneId } from '@/lib/knowledge/zone-map';
import { ZoneDetailView } from '@/components/dashboard/zone-detail-view';

type OnbResp = { question_key: string; answer: unknown };

const VALID_ZONE_IDS = new Set<string>(ZONES.map((z) => z.id));

export default async function ZoneDetailPage({
  params,
}: {
  params: Promise<{ zoneId: string }>;
}) {
  const { zoneId } = await params;
  if (!VALID_ZONE_IDS.has(zoneId)) notFound();

  const zone = ZONES.find((z) => z.id === zoneId)!;

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, business_type')
    .eq('user_id', user!.id)
    .single();
  if (!tenant) notFound();

  const verticalQuestions = QUESTIONS[tenant.business_type] ?? QUESTIONS.dental ?? [];
  const zoneQuestions = getQuestionsForZone(zoneId as ZoneId, verticalQuestions);

  const { data: onbResponses } = await supabase
    .from('onboarding_responses')
    .select('question_key, answer')
    .eq('tenant_id', tenant.id);

  const responsesMap: Record<string, unknown> = {};
  for (const r of (onbResponses || []) as OnbResp[]) {
    responsesMap[r.question_key] = r.answer;
  }

  return (
    <ZoneDetailView
      zone={zone}
      questions={zoneQuestions}
      allQuestions={verticalQuestions}
      initialResponses={responsesMap}
    />
  );
}
