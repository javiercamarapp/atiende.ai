import { supabaseAdmin } from '@/lib/supabase/admin';

// ═══════════════════════════════════════════════════════════
// LEAD SCORING — Incremental score updates after every interaction
// ═══════════════════════════════════════════════════════════

const SCORE_DELTAS: Record<string, number> = {
  APPOINTMENT_NEW: 15,
  APPOINTMENT_MODIFY: 5,
  APPOINTMENT_CANCEL: -5,
  ORDER_NEW: 20,
  ORDER_STATUS: 3,
  RESERVATION: 15,
  PRICE: 5,
  SERVICES_INFO: 5,
  HOURS: 3,
  LOCATION: 3,
  FAQ: 2,
  REVIEW: 10,
  GREETING: 1,
  THANKS: 8,
  COMPLAINT: 0,
  EMERGENCY: 0,
  HUMAN: 2,
  MEDICAL_QUESTION: 3,
  LEGAL_QUESTION: 3,
  FAREWELL: 1,
  SPAM: -50,
  OTHER: 1,
};

export async function updateLeadScore(contactId: string, intent: string) {
  if (!contactId) return;

  const delta = SCORE_DELTAS[intent] ?? 1;
  if (delta === 0) return;

  try {
    const { data: contact } = await supabaseAdmin
      .from('contacts')
      .select('lead_score')
      .eq('id', contactId)
      .single();

    const currentScore = contact?.lead_score || 0;
    const newScore = Math.max(0, Math.min(100, currentScore + delta));

    const temperature = newScore >= 70 ? 'hot' : newScore >= 40 ? 'warm' : 'cold';

    await supabaseAdmin.from('contacts').update({
      lead_score: newScore,
      lead_temperature: temperature,
    }).eq('id', contactId);
  } catch {
    // Best effort
  }
}
