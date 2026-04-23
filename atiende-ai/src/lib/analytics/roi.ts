import { supabaseAdmin } from '@/lib/supabase/admin';
import { PLAN_PRICES_MXN, PLAN_MSG_LIMITS_MONTHLY } from '@/lib/config';

const HOURLY_RATES: Record<string,number> = {
  dental:75,medical:75,nutritionist:70,psychologist:80,restaurant:55,taqueria:50,
  cafe:50,hotel:80,real_estate:100,salon:60,barbershop:55,spa:65,gym:55,
  veterinary:65,pharmacy:55,school:65,insurance:90,mechanic:55,accountant:85,
  florist:50,optics:60,other:62.5,
};
const SERVICE_VALUES: Record<string,number> = {
  dental:800,medical:600,nutritionist:700,psychologist:800,restaurant:350,
  taqueria:150,cafe:120,hotel:2500,real_estate:50000,salon:450,barbershop:200,
  spa:900,gym:400,veterinary:500,pharmacy:200,school:3000,insurance:5000,
  mechanic:1500,accountant:2000,florist:500,optics:1200,other:500,
};
const PLAN_PRICES = PLAN_PRICES_MXN;

export interface ROIResult {
  messagesSaved:number; minutesSaved:number; hoursSaved:number;
  staffSavingsMXN:number; afterHoursRevenueMXN:number; noShowSavingsMXN:number;
  totalSavingsMXN:number; monthlyCostMXN:number; roiPercent:number;
}

interface AnalyticsRow {
  messages_inbound?: number;
  handoffs_human?: number;
  appointments_after_hours?: number;
  appointments_booked?: number;
  appointments_no_show?: number;
  [key: string]: unknown;
}

export function calculateROI(
  tenant:{business_type:string;plan:string}, analytics:AnalyticsRow[]
): ROIResult {
  const msgSaved = analytics.reduce((s,d) => s+(d.messages_inbound||0)-(d.handoffs_human||0),0);
  const minSaved = msgSaved * 2.5;
  const hrSaved = minSaved / 60;
  const staffSav = hrSaved * (HOURLY_RATES[tenant.business_type]||62.5);
  const afterHrs = analytics.reduce((s,d) => s+(d.appointments_after_hours||0),0);
  const svcVal = SERVICE_VALUES[tenant.business_type]||500;
  const afterRev = afterHrs * svcVal;
  const noShows = analytics.reduce((s,d) => s+Math.max(0,(d.appointments_booked||0)*0.15-(d.appointments_no_show||0)),0);
  const noShowSav = noShows * svcVal;
  const cost = PLAN_PRICES[tenant.plan] ?? PLAN_PRICES.basic;
  const total = staffSav + afterRev + noShowSav;
  const roi = cost>0?((total-cost)/cost)*100:0;
  return { messagesSaved:msgSaved, minutesSaved:Math.round(minSaved),
    hoursSaved:Math.round(hrSaved*10)/10, staffSavingsMXN:Math.round(staffSav),
    afterHoursRevenueMXN:Math.round(afterRev), noShowSavingsMXN:Math.round(noShowSav),
    totalSavingsMXN:Math.round(total), monthlyCostMXN:cost, roiPercent:Math.round(roi) };
}

export async function getMonthlyUsage(tenantId: string) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count } = await supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('direction', 'inbound')
    .gte('created_at', startOfMonth.toISOString());

  return count || 0;
}

// Plan message limits for ROI/usage dashboards. Falls back to the central
// constant in config.ts; premium is treated as effectively unlimited for
// dashboard visualisation purposes (real enforcement is in gates.ts).
export function getPlanLimit(plan: string): number {
  if (plan === 'premium') return 999999;
  return PLAN_MSG_LIMITS_MONTHLY[plan] ?? PLAN_MSG_LIMITS_MONTHLY.free_trial;
}
