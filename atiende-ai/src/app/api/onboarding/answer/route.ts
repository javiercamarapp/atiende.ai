// TODO(onboarding-v2): deprecated — replaced by /api/onboarding/chat.
// Delete in a follow-up PR once the conversational flow is validated in prod.
import { NextResponse } from 'next/server';
import { processAnswer } from '@/lib/onboarding/answer-processor';
import { getNextQuestion, formatInsightMessage } from '@/lib/onboarding/question-engine';
import type { VerticalEnum } from '@/lib/verticals/types';

export async function POST(request: Request) {
  const { vertical, questionNumber, answer } = await request.json();

  if (!vertical || !questionNumber || answer === undefined) {
    return NextResponse.json({ error: 'vertical, questionNumber, and answer required' }, { status: 400 });
  }

  const result = processAnswer(vertical as VerticalEnum, questionNumber, answer);

  if (!result.isValid) {
    return NextResponse.json({
      isValid: false,
      errorMessage: result.errorMessage,
    });
  }

  // Get the current question to check for insights
  const q = getNextQuestion(vertical as VerticalEnum, questionNumber);
  const insight = q ? formatInsightMessage(q) : null;

  return NextResponse.json({
    isValid: true,
    questionKey: result.questionKey,
    value: result.value,
    insight,
  });
}
