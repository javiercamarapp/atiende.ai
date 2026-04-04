import { NextResponse } from 'next/server';
import { generateAgentConfig } from '@/lib/onboarding/generate-agent';
import type { VerticalEnum } from '@/lib/verticals/types';

export async function POST(request: Request) {
  const { vertical, answers, businessName } = await request.json();

  if (!vertical || !answers || !businessName) {
    return NextResponse.json({ error: 'vertical, answers, and businessName required' }, { status: 400 });
  }

  const config = generateAgentConfig(
    vertical as VerticalEnum,
    answers,
    businessName,
  );

  // TODO: In production, save to tenants.agent_config via Supabase
  // For now, just return the generated config
  return NextResponse.json({
    success: true,
    config: {
      verticalType: config.verticalType,
      businessName: config.businessName,
      promptLength: config.systemPrompt.length,
      neverHallucinateRules: config.neverHallucinate.length,
      crisisProtocols: config.crisisProtocols.length,
      topFaqs: config.topFaqs.length,
    },
  });
}
