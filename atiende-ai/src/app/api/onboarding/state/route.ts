// GET /api/onboarding/state
// Returns the user's saved onboarding state so the chat resumes after
// a refresh. Returns 401 if unauthenticated.

import { NextResponse } from 'next/server';
import { getAuthUserId, loadOnboardingState } from '@/lib/onboarding/persistence';
import { getVerticalQuestions, VERTICAL_NAMES } from '@/lib/verticals';

export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const state = await loadOnboardingState(userId);

  if (!state.vertical) {
    return NextResponse.json({
      hasSavedState: false,
      tenantId: state.tenantId,
    });
  }

  const questions = getVerticalQuestions(state.vertical);
  const totalQuestions = questions.length;
  const collected = Object.keys(state.answers).length;

  return NextResponse.json({
    hasSavedState: true,
    tenantId: state.tenantId,
    vertical: state.vertical,
    verticalName: VERTICAL_NAMES[state.vertical],
    businessName: state.businessName,
    answers: state.answers,
    totalQuestions,
    collected,
  });
}
