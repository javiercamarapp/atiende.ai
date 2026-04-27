import { NextRequest, NextResponse } from 'next/server';
import { getStripe } from '@/lib/billing/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logWebhook, enforceWebhookSize, enforceWebhookSizePostRead, WEBHOOK_MAX_BYTES } from '@/lib/webhook-logger';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  // Guard de tamaño ANTES de bufferear.
  const sizeCheck = enforceWebhookSize(req, WEBHOOK_MAX_BYTES, 'stripe', startTime);
  if (!sizeCheck.ok) return sizeCheck.response;

  const body = await req.text();

  const postRead = enforceWebhookSizePostRead(Buffer.byteLength(body, 'utf8'), WEBHOOK_MAX_BYTES, 'stripe', startTime);
  if (!postRead.ok) return postRead.response;
  const sig = req.headers.get('stripe-signature')!;
  let event;

  try {
    event = getStripe().webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    logWebhook({ provider: 'stripe', eventType: 'auth_failed', statusCode: 400, error: 'Invalid signature', durationMs: Date.now() - startTime });
    return NextResponse.json({ error: 'Invalid sig' }, { status: 400 });
  }

  const obj = event.data.object as unknown as Record<string, unknown>;
  const tenantId = obj?.metadata
    ? (obj.metadata as Record<string, string>)?.tenant_id
    : undefined;

  // Idempotency check contra processed_stripe_events.
  // Stripe reintenta el mismo event.id con semántica at-least-once.
  const { error: dedupError } = await supabaseAdmin
    .from('processed_stripe_events')
    .insert({ event_id: event.id, event_type: event.type });
  if (dedupError) {
    // Código 23505 = unique_violation → evento ya procesado. Ack con 200.
    if (dedupError.code === '23505') {
      logWebhook({
        tenantId,
        provider: 'stripe',
        eventType: 'duplicate_skip',
        statusCode: 200,
        payload: { event_id: event.id, type: event.type },
        durationMs: Date.now() - startTime,
      });
      return NextResponse.json({ received: true, duplicate: true });
    }
    // Error real de DB — log y continuar (fail-open para no bloquear Stripe).
    logger.error('[stripe-webhook] idempotency insert failed', undefined, {  err: dedupError.message, eventId: event.id  });
  }

  logWebhook({
    tenantId,
    provider: 'stripe',
    eventType: event.type,
    statusCode: 200,
    payload: { event_id: event.id, type: event.type },
    durationMs: Date.now() - startTime,
  });

  // ─── Per-doctor subscription events ───────────────────────────────────
  // Detectamos por metadata.billing_type='per_doctor' que seteamos en
  // createDoctorCheckout. Estos NO van por la lógica de tenant-level
  // billing — cada doctor tiene su propia subscription.
  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const sub = event.data.object as unknown as {
      id: string;
      status: string;
      metadata?: Record<string, string>;
      trial_end?: number | null;
      items?: { data?: Array<{ price?: { metadata?: Record<string, string>; id?: string } }> };
    };
    const subMeta = sub.metadata || sub.items?.data?.[0]?.price?.metadata;
    if (subMeta?.billing_type === 'per_doctor' && subMeta?.staff_id) {
      try {
        const { handleDoctorSubscriptionEvent } = await import('@/lib/billing/per-doctor');
        await handleDoctorSubscriptionEvent({
          subscriptionId: sub.id,
          status: sub.status as Parameters<typeof handleDoctorSubscriptionEvent>[0]['status'],
          plan: subMeta.plan as Parameters<typeof handleDoctorSubscriptionEvent>[0]['plan'],
          staffId: subMeta.staff_id,
          trialEnd: sub.trial_end ?? null,
        });
      } catch (err) {
        console.error('[stripe webhook] per-doctor handler failed:', err);
      }
      // Per-doctor subscription handled — early return para no aplicar la
      // lógica tenant-level que abajo asume que `customer = tenant.customer`.
      return NextResponse.json({ received: true, type: 'per_doctor_subscription' });
    }
    // Si no es per_doctor, sigue al handler tenant-level abajo.
  }

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object as unknown as Record<string, unknown>;
    const meta = s.metadata as Record<string, string> | undefined;

    // Per-doctor checkout completion: el subscription event va a llegar
    // separado, así que aquí solo log + return early para no entrar a la
    // lógica tenant-level.
    if (meta?.billing_type === 'per_doctor' || meta?.staff_id) {
      console.info('[stripe webhook] per-doctor checkout completed', {
        staff_id: meta.staff_id,
        plan: meta.plan,
      });
      return NextResponse.json({ received: true, type: 'per_doctor_checkout' });
    }

    // Appointment payment (Patient Payment Portal, Phase 1) — distinto al
    // flujo de suscripciones del tenant. kind='appointment_payment' lo
    // seteamos en createAppointmentPaymentLink.
    if (meta?.kind === 'appointment_payment') {
      const appointmentId = meta.appointment_id;
      const tenantId = meta.tenant_id;
      if (!appointmentId || !tenantId) {
        logger.warn('[stripe-webhook] appointment_payment missing metadata', { session: s.id });
        return NextResponse.json({ received: true });
      }
      try {
        await supabaseAdmin
          .from('appointments')
          .update({
            payment_status: 'paid',
            payment_method: 'stripe_checkout',
            payment_received_at: new Date().toISOString(),
          })
          .eq('id', appointmentId)
          .eq('tenant_id', tenantId);

        // Notificar al dueño (fire-and-forget)
        void import('@/lib/actions/notifications').then(({ notifyOwner }) =>
          notifyOwner({
            tenantId,
            event: 'new_appointment',
            details:
              `💰 Pago recibido\n\n` +
              `Paciente: ${meta.patient_name || 'sin nombre'} (${meta.patient_phone || ''})\n` +
              `Cita: ${appointmentId}\n` +
              `Monto: $${(((s.amount_total as number) || 0) / 100).toLocaleString('es-MX')} MXN`,
          }).catch((err) => {
            logger.warn('[stripe-webhook] notifyOwner failed', { err: err instanceof Error ? err.message : err, appointmentId });
          }),
        );

        logger.info('[stripe-webhook] appointment payment completed', { appointmentId, tenantId });
      } catch (err) {
        logger.error('[stripe-webhook] failed to mark appointment paid', undefined, {
          err: err instanceof Error ? err.message : String(err),
          appointmentId,
        });
      }
      return NextResponse.json({ received: true });
    }

    const tid = meta?.tenant_id;
    const plan = meta?.plan;
    const stripeCustomer = s.customer as string | undefined;

    if (tid && plan && stripeCustomer) {
      // Defense-in-depth contra metadata-replay cross-tenant:
      //
      // Caso 1 (existing customer): el tenant ya tiene stripe_customer_id en
      // file → el customer del evento DEBE coincidir. Bloqueamos si difiere.
      //
      // Caso 2 (first checkout): el tenant aún NO tiene stripe_customer_id
      // (es el primer checkout exitoso). Antes confiábamos ciegamente en la
      // metadata.tenant_id de la session — un atacante podía manipularla
      // y asignar el customer a otro tenant. Ahora cross-checkeamos contra
      // el email del customer en Stripe vs el email del owner del tenant.
      // Si no coincide o no se puede recuperar, rechazamos el evento
      // (el cron de reconciliación o el portal manual lo arreglará si
      // es false-positive legítimo).
      const { data: existing } = await supabaseAdmin
        .from('tenants')
        .select('stripe_customer_id, owner_email, user_id')
        .eq('id', tid)
        .single();

      if (existing?.stripe_customer_id) {
        if (existing.stripe_customer_id !== stripeCustomer) {
          logger.warn('[stripe-webhook] customer mismatch — rejecting metadata replay', {  tenantId: tid, existing: existing.stripe_customer_id, event: stripeCustomer  });
          const { trackError } = await import('@/lib/monitoring');
          trackError('stripe_metadata_replay_blocked');
          return NextResponse.json({ received: true });
        }
      } else {
        // First checkout: validar email del customer Stripe vs owner email.
        try {
          const customer = await getStripe().customers.retrieve(stripeCustomer);
          const customerEmail = !('deleted' in customer) ? customer.email?.toLowerCase().trim() : null;
          const ownerEmail = (existing?.owner_email as string | null)?.toLowerCase().trim();
          // Si el tenant tiene owner_email y NO coincide con el del customer,
          // alguien metió tenant_id ajeno en metadata. Bloquear.
          if (ownerEmail && customerEmail && ownerEmail !== customerEmail) {
            logger.warn('[stripe-webhook] first-checkout email mismatch — rejecting cross-tenant metadata', {  tenantId: tid, customer_email_hash: customerEmail.slice(0, 3) + '***', owner_email_hash: ownerEmail.slice(0, 3) + '***'  });
            const { trackError } = await import('@/lib/monitoring');
            trackError('stripe_first_checkout_email_mismatch');
            return NextResponse.json({ received: true });
          }
        } catch (err) {
          logger.warn('[stripe-webhook] could not retrieve customer for cross-check', {  tenantId: tid, err: err instanceof Error ? err.message : err  });
          // No bloqueamos en error de red — Stripe ya firmó el webhook.
          // Sólo bloqueamos en mismatch positivo.
        }
      }
      // Auto-populate voice fields para plan premium.
      // El checkout de premium incluye 2 line_items: el plan + el metered
      // voice. Buscamos el subscription_item del metered en la subscription
      // y lo guardamos para que el cron mensual reporte usage.
      let voicePatch: Record<string, unknown> = {};
      if (plan === 'premium') {
        try {
          const subId = s.subscription as string | undefined;
          if (subId) {
            const sub = await getStripe().subscriptions.retrieve(subId, {
              expand: ['items.data.price'],
            });
            const meteredItem = sub.items?.data?.find(
              (it) => it.price?.recurring?.usage_type === 'metered',
            );
            voicePatch = {
              voice_minutes_included: 300,
              stripe_subscription_item_voice_id: meteredItem?.id ?? null,
            };
            if (!meteredItem) {
              // Revenue leak risk: premium subscription sin metered item
              // significa que NO podemos cobrar overage de voz. Antes solo
              // loggeábamos warn. Ahora elevamos a error + trackError +
              // alerta al owner vía notifyOwner para que pueda contactar
              // soporte de Stripe inmediato.
              const { trackError } = await import('@/lib/monitoring');
              trackError('stripe_premium_no_metered_item');
              logger.error('[stripe-webhook] CRITICAL: premium subscription lacks metered item — voice overage cannot be billed', undefined, {
                tenantId: tid,
                subscriptionId: subId,
              });
              try {
                const { notifyOwner } = await import('@/lib/actions/notifications');
                await notifyOwner({
                  tenantId: tid as string,
                  event: 'complaint',
                  details: `⚠️ Billing config issue — your premium subscription is missing the metered voice item in Stripe. Overage cannot be billed until this is fixed. Contact support.`,
                });
              } catch {
                /* best effort */
              }
            }
          }
        } catch (err) {
          const { trackError } = await import('@/lib/monitoring');
          trackError('stripe_subscription_fetch_failed');
          logger.error('[stripe-webhook] failed to fetch subscription items', undefined, {  err: err instanceof Error ? err.message : err, tenantId: tid  });
        }
      }

      await supabaseAdmin
        .from('tenants')
        .update({ plan, stripe_customer_id: stripeCustomer, ...voicePatch })
        .eq('id', tid);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as unknown as Record<string, unknown>;
    const { data: t } = await supabaseAdmin.from('tenants').select('id').eq('stripe_customer_id', sub.customer as string).single();
    if (t) {
      // También limpiamos voice_minutes_included y subscription_item_voice_id
      // — al cancelar el premium ya no debe acumular overage facturable.
      await supabaseAdmin.from('tenants').update({
        plan: 'free_trial',
        status: 'paused',
        voice_minutes_included: 0,
        stripe_subscription_item_voice_id: null,
      }).eq('id', t.id);
    }
  }

  // Payment failure: pausar tenant hasta que el pago se resuelva. Sin este
  // handler el tenant seguía activo post-tarjeta-declinada y nos sangraba
  // en LLM+WhatsApp+infra.
  if (event.type === 'invoice.payment_failed') {
    const inv = event.data.object as unknown as Record<string, unknown>;
    const customerId = inv.customer as string | undefined;
    if (customerId) {
      const { data: tenantRow } = await supabaseAdmin
        .from('tenants')
        .update({ status: 'past_due' })
        .eq('stripe_customer_id', customerId)
        .select('id')
        .maybeSingle();

      // Audit fix: log payment failure para compliance + alerting.
      // trackError counter dispara alertas si pasa >threshold/hr.
      const { trackError } = await import('@/lib/monitoring');
      trackError('stripe_payment_failed');
      if (tenantRow?.id) {
        const { logAudit } = await import('@/lib/audit');
        await logAudit({
          tenantId: tenantRow.id as string,
          action: 'payment_failed',
          entityType: 'invoice',
          entityId: (inv.id as string) || undefined,
          details: {
            amount_due: inv.amount_due,
            attempt_count: inv.attempt_count,
            failure_code: (inv as { last_finalization_error?: { code?: string } }).last_finalization_error?.code,
          },
        }).catch((err) => logger.warn('[stripe.webhook] audit failed', { err }));
      }
    }
  }

  // Payment recovery. Si un tenant estaba en past_due y paga tarde (invoice
  // retry exitoso), Stripe dispara invoice.payment_succeeded pero NO un
  // customer.subscription.updated consistente. Sin este handler el tenant
  // queda permanentemente past_due aunque ya esté al corriente = revenue
  // leak + tenant bloqueado en producción aun pagando.
  if (event.type === 'invoice.payment_succeeded') {
    const inv = event.data.object as unknown as {
      customer?: string;
      billing_reason?: string;
    };
    const customerId = inv.customer;
    if (customerId) {
      // Solo re-activamos si la razón indica recuperación de pago recurrente.
      // Otros billing_reason (subscription_create, manual) ya los maneja
      // customer.subscription.created/updated para setear plan correcto.
      const isRecovery =
        inv.billing_reason === 'subscription_cycle' ||
        inv.billing_reason === 'subscription_update';
      if (isRecovery) {
        await supabaseAdmin
          .from('tenants')
          .update({ status: 'active' })
          .eq('stripe_customer_id', customerId)
          .eq('status', 'past_due'); // no-op si ya está active
      }
    }
  }

  // Subscription updates (upgrade/downgrade desde el portal de Stripe). Sin
  // este handler la app quedaba desincronizada con el plan real pagado. Se
  // detecta el plan por el product.metadata.plan o por el precio — aquí
  // priorizamos el metered voice item para detectar premium.
  if (event.type === 'customer.subscription.updated') {
    const sub = event.data.object as unknown as {
      customer?: string;
      status?: string;
      items?: { data?: Array<{ id?: string; price?: { recurring?: { usage_type?: string }; metadata?: Record<string, string> } }> };
      cancel_at_period_end?: boolean;
    };
    const customerId = sub.customer;
    if (customerId) {
      const meteredItem = sub.items?.data?.find(
        (it) => it.price?.recurring?.usage_type === 'metered',
      );
      const isPremium = Boolean(meteredItem);
      // Audit fix: status mapping completo. Antes solo checkeaba 'active' →
      // mapeaba todo lo demás a 'past_due', incluso 'trialing'. Esto causaba
      // race con invoice.payment_succeeded que podía dejar tenant past_due
      // tras pago exitoso. Ahora mapeamos cada status Stripe explícitamente.
      const stripeToInternal = (s?: string): string => {
        switch (s) {
          case 'active':
          case 'trialing':
            return 'active';
          case 'past_due':
          case 'unpaid':
            return 'past_due';
          case 'canceled':
          case 'incomplete_expired':
            return 'cancelled';
          case 'paused':
            return 'paused';
          case 'incomplete':
            return 'incomplete';
          default:
            return 'past_due';
        }
      };
      const patch: Record<string, unknown> = {
        status: stripeToInternal(sub.status),
      };
      if (isPremium) {
        patch.plan = 'premium';
        patch.voice_minutes_included = 300;
        patch.stripe_subscription_item_voice_id = meteredItem?.id ?? null;
      } else {
        // Downgrade desde premium: el metered item desapareció.
        patch.voice_minutes_included = 0;
        patch.stripe_subscription_item_voice_id = null;
      }
      await supabaseAdmin
        .from('tenants')
        .update(patch)
        .eq('stripe_customer_id', customerId);
    }
  }

  return NextResponse.json({ received: true });
}
