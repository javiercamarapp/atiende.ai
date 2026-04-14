// ═════════════════════════════════════════════════════════════════════════════
// DEPRECATED — replaced by /api/onboarding/chat (conversational flow).
// Returns HTTP 410 Gone with migration instructions.
// Kept as zombie route for any legacy client still hitting this path.
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
