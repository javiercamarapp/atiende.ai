// ═══════════════════════════════════════════════════════════════════════════
// MFA MANAGEMENT — TOTP enrollment, verification, unenrollment
//
// Uses Supabase Auth's built-in MFA factors (TOTP). The dashboard owner
// enrolls via POST (gets QR URI + secret), verifies via PUT (submits the
// first TOTP code to activate the factor), or unenrolls via DELETE.
//
// Once enrolled, Supabase Auth enforces the TOTP challenge on every login
// automatically — no custom middleware needed for the challenge flow itself.
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase } from '@/lib/supabase/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// POST /api/auth/mfa — Enroll a new TOTP factor
export async function POST() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: 'Atiende.ai Authenticator',
  });

  if (error) {
    return NextResponse.json(
      { error: 'enroll_failed', message: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  });
}

const VerifyBody = z.object({
  factorId: z.string().uuid(),
  code: z.string().length(6),
});

// PUT /api/auth/mfa — Verify (activate) an enrolled TOTP factor
export async function PUT(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof VerifyBody>;
  try {
    body = VerifyBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const challenge = await supabase.auth.mfa.challenge({ factorId: body.factorId });
  if (challenge.error) {
    return NextResponse.json(
      { error: 'challenge_failed', message: challenge.error.message },
      { status: 400 },
    );
  }

  const verify = await supabase.auth.mfa.verify({
    factorId: body.factorId,
    challengeId: challenge.data.id,
    code: body.code,
  });

  if (verify.error) {
    return NextResponse.json(
      { error: 'verify_failed', message: verify.error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ status: 'mfa_active' });
}

const UnenrollBody = z.object({
  factorId: z.string().uuid(),
});

// DELETE /api/auth/mfa — Unenroll a TOTP factor
export async function DELETE(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: z.infer<typeof UnenrollBody>;
  try {
    body = UnenrollBody.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const { error } = await supabase.auth.mfa.unenroll({ factorId: body.factorId });
  if (error) {
    return NextResponse.json(
      { error: 'unenroll_failed', message: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({ status: 'mfa_removed' });
}

// GET /api/auth/mfa — List enrolled factors
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    return NextResponse.json(
      { error: 'list_failed', message: error.message },
      { status: 400 },
    );
  }

  return NextResponse.json({
    factors: data.totp.map(f => ({
      id: f.id,
      friendlyName: f.friendly_name,
      status: f.factor_type,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    })),
  });
}
