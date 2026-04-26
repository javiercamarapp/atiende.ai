# Production Deployment — WhatsApp Launch Checklist

Pasos obligatorios antes de conectar un número de WhatsApp con clientes
reales después del commit `6f77197`.

## 1. Aplicar la migración SQL

Las nuevas columnas, función RLS plural, EXCLUDE constraint y demás cambios
del schema NO se aplican solos con un deploy a Vercel. Hay que correrlos en
Supabase prod manualmente.

1. Abrir Supabase Dashboard → SQL Editor → New Query
2. Pegar el contenido completo de
   `supabase/migrations/production_readiness_fixes.sql`
3. Run
4. Verificar con los SELECTs que están al final del archivo

La migración es **idempotente**: seguro de correr dos veces.

## 2. Variables de entorno

Confirmar en Vercel project settings:

| Var | Crítica | Descripción |
|-----|---------|-------------|
| `OPENROUTER_API_KEY` | ✅ | Sin esto el clasificador y los handlers caen |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Solo server-side. Nunca exponer al cliente |
| `WA_APP_SECRET` | ✅ | HMAC-SHA256 del webhook de WhatsApp |
| `WA_SYSTEM_TOKEN` | ✅ | Bearer token global de WhatsApp Cloud API |
| `CRON_SECRET` | ✅ | Protege endpoints `/api/cron/*` (incluye el nuevo `calendar-reconcile`) |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Solo si Stripe activo |
| `UPSTASH_REDIS_URL` + `_TOKEN` | ✅ | Rate limiting + state machine |
| `GOOGLE_CLIENT_ID` + `_SECRET` | ✅ | OAuth Calendar |
| `SENTRY_DSN` | Recomendado | Sin esto, errores en prod son ciegos |
| `PII_ENCRYPTION_KEY` | ✅ | AES-256-GCM para teléfonos/nombres at rest |

## 3. Smoke test end-to-end (staging)

Antes de prod, correr contra un número de WhatsApp staging:

- [ ] Mensaje "hola" → bot responde welcome
- [ ] "agendar mañana 10am" → cita en DB + evento en Google Calendar del staff
- [ ] Misma frase en otra ventana paralela mismo slot → segundo mensaje
      recibe "esa hora ya no está disponible" (EXCLUDE constraint hizo su
      trabajo)
- [ ] "cambiar mi cita al jueves 3pm" → UPDATE + patch al evento
- [ ] "cancelar mi cita" → UPDATE status='cancelled' + delete del evento
- [ ] Apagar Google Calendar API (revocar OAuth temporalmente o block en
      firewall) → agendar cita → ver `calendar_sync_status='pending'` en
      DB → restaurar acceso → en <5min el cron `calendar-reconcile`
      sincroniza
- [ ] `GET /api/health` con `Authorization: Bearer $CRON_SECRET` →
      `services.calendarSync` debe ser `'ok'`
- [ ] Mensaje ambigüo de alto riesgo (ej. "mi cita es urgente, dolor
      fuerte") → classifier reclasifica con Gemini Flash y/o escala a
      HUMAN si confidence sigue baja

## 4. Gaps conocidos (NO bloqueantes, pero documenta el riesgo)

### Reservaciones de restaurante (`RESERVATION` intent)

El EXCLUDE constraint anti-doble-booking aplica solo cuando hay `staff_id`.
Reservaciones de mesas/cuartos no tienen staff y por diseño quedan fuera —
la lógica de capacidad (table count, room inventory) es responsabilidad del
tenant en `tenant.config`. Hoy `handleReservation` no implementa límite de
capacidad, así que **dos clientes pueden reservar para el mismo slot**.

Mitigación temporal:
- Solo activar el bot para verticals que sí tienen staff (dental, médico,
  veterinario, salón, barbería, spa, gym) hasta que se implemente
  capacity-based booking.
- Para hoteles/restaurantes, mantener bot en modo "atender consulta + escalar
  a humano para reservar" (no auto-reserva).

### Drift bidireccional Google Calendar

Si el staff borra un evento manualmente desde Google Calendar (no a través
del bot), la cita queda en estado `synced` en Postgres con un
`google_event_id` que ya no existe remotamente. El cliente cree que tiene
cita, el doctor no la ve.

Esto **no es bloqueante** para conectar producción porque:
- Usuarios nuevos no van a borrar eventos manualmente al inicio
- Existe ya `renew-calendar-watches` cron + push notifications de Google
  para casos avanzados (Fase 2)

Mitigación: avisar a los staff durante onboarding que las citas se
gestionan desde el bot, no manualmente.

### Tool-calling real (Fase 2)

Hoy el path productivo es `classifier → intent → handler` (árbol de
decisión). Hay flag `USE_TOOL_CALLING=false` que mantiene apagado el
orquestador con tool-calling nativo. **Dejarlo apagado en el piloto.**

## 5. Crons que tienen que estar corriendo

Verificar en Vercel Dashboard → Cron Jobs:

- `/api/cron/calendar-reconcile` — `*/5 * * * *` (NUEVO en este commit)
- `/api/cron/reminders` — `0 * * * *`
- `/api/cron/no-show-reminders` — `0 0 * * *`
- `/api/cron/renew-calendar-watches` — `0 */6 * * *`

Si Vercel no detectó el nuevo cron, hacer redeploy.

## 6. Monitoreo post-launch (primeras 48h)

Endpoints/queries a vigilar manualmente:

```sql
-- Citas con sync pendiente o fallido
SELECT calendar_sync_status, COUNT(*)
FROM appointments
GROUP BY calendar_sync_status;

-- Conflictos detectados (debería ser >0 si el bot tiene volumen)
SELECT COUNT(*) FROM audit_log
WHERE action = 'agent.action.appointment.conflict'
AND created_at > NOW() - INTERVAL '24 hours';

-- Confidence promedio del classifier
SELECT AVG(confidence), COUNT(*)
FROM classification_feedback
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY model_variant;

-- Sync stuck (>30min sin progreso)
SELECT id, calendar_sync_status, calendar_sync_attempts, calendar_sync_last_error
FROM appointments
WHERE calendar_sync_status = 'failed'
   OR (calendar_sync_status IN ('pending', 'cancel')
       AND calendar_sync_next_retry_at < NOW() - INTERVAL '30 minutes');
```

Si `calendar_sync_status='failed'` aparece, revisar `calendar_sync_last_error`
del row específico — la cita está en Postgres pero no en Google y necesita
intervención manual.
