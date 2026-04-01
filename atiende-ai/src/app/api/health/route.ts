import { NextResponse } from 'next/server';

// PUBLIC ENDPOINT — Intentionally unauthenticated
// Used by Vercel, load balancers, and uptime monitors
// Does NOT expose any sensitive data
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
}
