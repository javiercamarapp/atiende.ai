import { sendTextMessage } from '@/lib/whatsapp/send';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface TenantRecord {
  id: string;
  name: string;
  status: string;
  plan: string;
  business_type?: string;
  wa_phone_number_id: string;
  welcome_message?: string;
  chat_system_prompt?: string;
  temperature?: number;
  address?: string;
  [key: string]: unknown;
}

export async function runPostResponseEffects(
  tenant: TenantRecord,
  phoneNumberId: string,
  senderPhone: string,
  conversationId: string,
  contactId: string,
  contactName: string,
  customerName: string,
  intent: string,
  content: string,
) {
  // Agentic actions
  try {
    const { executeAction } = await import('@/lib/actions/engine');
    const actionResult = await executeAction({
      tenantId: tenant.id,
      phoneNumberId,
      customerPhone: senderPhone,
      customerName,
      contactId,
      conversationId,
      intent,
      content,
      businessType: tenant.business_type as string,
      tenant,
    });
    if (actionResult.actionTaken && actionResult.followUpMessage) {
      await sendTextMessage(phoneNumberId, senderPhone, actionResult.followUpMessage);
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenant.id,
        direction: 'outbound',
        sender_type: 'bot',
        content: actionResult.followUpMessage,
        message_type: 'text',
        intent: `action.${actionResult.actionType}`,
      });
    }

    // Notify owner for critical actions
    if (
      actionResult.actionTaken &&
      ['order.created', 'complaint.escalated', 'emergency.escalated', 'crisis.detected', 'appointment.created'].includes(actionResult.actionType || '')
    ) {
      try {
        const { notifyOwner } = await import('@/lib/actions/notifications');
        const eventMap: Record<string, 'new_order' | 'new_appointment' | 'complaint' | 'emergency' | 'crisis'> = {
          'order.created': 'new_order',
          'complaint.escalated': 'complaint',
          'emergency.escalated': 'emergency',
          'crisis.detected': 'crisis',
          'appointment.created': 'new_appointment',
        };
        await notifyOwner({
          tenantId: tenant.id,
          event: eventMap[actionResult.actionType!] || 'new_order',
          details: `Cliente: ${senderPhone}\n${actionResult.followUpMessage?.slice(0, 200) || ''}`,
        });
      } catch (err) {
        console.warn('[side-effects] notifyOwner for critical action failed:', err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.warn('[side-effects] agentic actions failed:', err instanceof Error ? err.message : err);
  }

  // Industry-specific actions
  try {
    const { executeIndustryAction } = await import('@/lib/actions/industry-actions');
    const industryResult = await executeIndustryAction({
      tenantId: tenant.id,
      phoneNumberId,
      customerPhone: senderPhone,
      customerName,
      contactId,
      conversationId,
      businessType: tenant.business_type as string,
      tenant,
      intent,
      content,
    });
    if (industryResult.acted && industryResult.message) {
      await sendTextMessage(phoneNumberId, senderPhone, industryResult.message);
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenant.id,
        direction: 'outbound',
        sender_type: 'bot',
        content: industryResult.message,
        message_type: 'text',
        intent: `industry.${tenant.business_type}`,
      });
    }
  } catch (err) {
    console.warn('[side-effects] industry-specific actions failed:', err instanceof Error ? err.message : err);
  }

  // Lead scoring
  try {
    const { updateLeadScore } = await import('@/lib/actions/lead-scoring');
    await updateLeadScore(contactId, intent);
  } catch (err) {
    console.warn('[side-effects] lead scoring failed:', err instanceof Error ? err.message : err);
  }

  // Hot lead routing
  try {
    if (contactId) {
      const { data: updatedContact } = await supabaseAdmin
        .from('contacts')
        .select('lead_score, lead_temperature')
        .eq('id', contactId)
        .single();
      if (updatedContact?.lead_temperature === 'hot' && updatedContact.lead_score >= 70) {
        const { notifyOwner } = await import('@/lib/actions/notifications');
        await notifyOwner({
          tenantId: tenant.id,
          event: 'lead_hot',
          details: `🔥 LEAD CALIENTE (Score: ${updatedContact.lead_score}/100)\n\nCliente: ${contactName || senderPhone}\nTel: ${senderPhone}\nÚltimo intent: ${intent}\n\n¡Contacte a este cliente AHORA!`,
        });
      }
    }
  } catch (err) {
    console.warn('[side-effects] hot lead routing failed:', err instanceof Error ? err.message : err);
  }
}
