// ═════════════════════════════════════════════════════════════════════════════
// DEPRECATED — replaced by /api/onboarding/chat.
// ═════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

const DEPRECATED_RESPONSE = {
  error: 'deprecated',
  message: 'Esta ruta fue reemplazada por /api/onboarding/chat',
  migration: 'Use POST /api/onboarding/chat en su lugar',
};

export async function POST() {
  return NextResponse.json(DEPRECATED_RESPONSE, { status: 410 });
}

export async function GET() {
  return NextResponse.json(DEPRECATED_RESPONSE, { status: 410 });
}
