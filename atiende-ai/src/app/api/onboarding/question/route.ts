import { NextResponse } from 'next/server';
import { getNextQuestion, formatQuestionMessage } from '@/lib/onboarding/question-engine';
import type { VerticalEnum } from '@/lib/verticals/types';

export async function POST(request: Request) {
  const { vertical, questionNumber, businessName } = await request.json();

  if (!vertical || !questionNumber) {
    return NextResponse.json({ error: 'vertical and questionNumber required' }, { status: 400 });
  }

  const q = getNextQuestion(vertical as VerticalEnum, questionNumber, businessName);

  if (!q) {
    return NextResponse.json({ error: 'Question not found' }, { status: 404 });
  }

  return NextResponse.json({
    questionNumber: q.questionNumber,
    totalQuestions: q.totalQuestions,
    text: q.text,
    why: q.why,
    inputType: q.inputType,
    required: q.required,
    isLastQuestion: q.isLastQuestion,
    formattedMessage: formatQuestionMessage(q),
  });
}
