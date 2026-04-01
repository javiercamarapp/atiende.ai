import { supabaseAdmin } from '@/lib/supabase/admin';

export async function trackAdClick(params: {
  tenantId: string;
  contactPhone: string;
  ctwaClid?: string;
  adId?: string;
  campaignId?: string;
  source?: string;
}) {
  if (!params.ctwaClid) return;

  await supabaseAdmin.from('contacts').update({
    metadata: {
      ad_source: params.source || 'meta',
      ctwa_clid: params.ctwaClid,
      ad_id: params.adId,
      campaign_id: params.campaignId,
      ad_click_at: new Date().toISOString(),
    },
  }).eq('tenant_id', params.tenantId).eq('phone', params.contactPhone);

  await supabaseAdmin.from('audit_log').insert({
    tenant_id: params.tenantId,
    action: 'ad_click.tracked',
    details: params,
  });
}
