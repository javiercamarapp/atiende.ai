import { supabaseAdmin } from '@/lib/supabase/admin';

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
const PLAN_PRICES: Record<string,number> = { free_trial:0, basic:499, pro:999, premium:1499 };

export interface ROIResult {
  messagesSaved:number; minutesSaved:number; hoursSaved:number;
  staffSavingsMXN:number; afterHoursRevenueMXN:number; noShowSavingsMXN:number;
  totalSavingsMXN:number; monthlyCostMXN:number; roiPercent:number;
}

export function calculateROI(
  tenant:{business_type:string;plan:string}, analytics:any[]
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
  const cost = PLAN_PRICES[tenant.plan]||499;
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

export function getPlanLimit(plan: string): number {
  const limits: Record<string, number> = {
    free_trial: 100,
    basic: 500,
    pro: 2000,
    premium: 999999, // unlimited
  };
  return limits[plan] || 100;
}
