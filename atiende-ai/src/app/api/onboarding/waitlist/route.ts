import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';

const WaitlistSchema = z.object({
  businessType: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  name: z.string().max(200).optional(),
  rawInput: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = WaitlistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { businessType, email, phone, name, rawInput } = parsed.data;

  try {
    await supabaseAdmin.from('waitlist').insert({
      business_type: businessType,
      email: email ?? null,
      phone: phone ?? null,
      name: name ?? null,
      raw_input: rawInput ?? null,
    });
  } catch (err) {
    // Best-effort — if the waitlist table doesn't exist yet, log and continue
    logger.warn('waitlist insert failed (table may not exist)', {
      error: (err as Error).message,
      businessType,
    });
  }

  logger.info('waitlist_signup', { businessType, hasEmail: !!email });

  return NextResponse.json({ success: true });
}
