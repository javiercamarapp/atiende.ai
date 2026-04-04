import { NextResponse } from 'next/server';
import { detectVertical } from '@/lib/onboarding/detect-vertical';

export async function POST(request: Request) {
  const { input } = await request.json();

  if (!input || typeof input !== 'string') {
    return NextResponse.json({ error: 'Input required' }, { status: 400 });
  }

  const result = await detectVertical(input);

  if (!result) {
    return NextResponse.json({ vertical: null });
  }

  return NextResponse.json(result);
}
