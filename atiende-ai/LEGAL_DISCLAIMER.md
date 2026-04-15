# Términos legales — Disclaimer médico (atiende.ai by useatiende.ai)

> **IMPORTANTE**: Este documento es una plantilla redactada por un ingeniero de
> software, NO por un abogado. Antes de publicarlo en `useatiende.ai/terminos`
> debe ser revisado y aprobado por un abogado mexicano especializado en
> derecho digital + protección de datos (LFPDPPP) + responsabilidad civil.

---

## Disclaimer médico — para incluir en Términos y Condiciones

### Sección recomendada: "Naturaleza del Servicio y Limitaciones Médicas"

useatiende.ai (en adelante, "la Plataforma") es una herramienta de software
de inteligencia artificial diseñada exclusivamente para asistir a
consultorios, clínicas y profesionales independientes del sector salud y
estética en la **gestión administrativa de citas, recordatorios y
comunicación de rutina con sus pacientes** vía WhatsApp.

**La Plataforma NO constituye, ni pretende constituir, un servicio médico,
de diagnóstico, de prescripción farmacológica, ni de asesoría clínica de
ningún tipo.** El asistente automatizado provisto por la Plataforma:

1. **NO emite diagnósticos médicos**, presuntivos o definitivos. Cualquier
   pregunta del paciente relacionada con síntomas, condiciones, fotografías
   de estudios, lesiones o documentación clínica es redirigida al
   profesional de salud responsable del consultorio.

2. **NO recomienda, prescribe, modifica ni sugiere tratamientos
   farmacológicos o procedimientos médicos.** Las funciones de "recordatorio
   de medicamento" se limitan exclusivamente a notificar al paciente sobre
   prescripciones que el profesional tratante haya capturado previamente en
   el sistema; la Plataforma NUNCA genera dosis, posologías ni indicaciones
   por su cuenta.

3. **NO sustituye el juicio clínico** del médico tratante, ni la consulta
   presencial. Toda decisión médica permanece bajo la responsabilidad
   exclusiva del profesional de salud que opera el consultorio.

4. **NO debe ser utilizada en situaciones de urgencia médica.** La
   Plataforma cuenta con guardrails que detectan lenguaje de crisis
   (incluyendo crisis suicida) y redirige al paciente a líneas de
   emergencia (911, Línea de la Vida 800-911-2000, SAPTEL 55-5259-8121)
   y al teléfono del consultorio. Sin embargo, en cualquier urgencia el
   paciente DEBE marcar al 911 o acudir directamente al servicio de
   urgencias más cercano.

### Sección recomendada: "Limitación de Responsabilidad"

El consultorio o profesional de salud que contrate la Plataforma reconoce
y acepta que:

- Es el único responsable del cuidado clínico de sus pacientes.
- Es responsable de revisar y validar la información comunicada por la
  Plataforma a sus pacientes (precios, horarios, ubicaciones, servicios).
- Es responsable de configurar correctamente el catálogo de servicios,
  tarifas y disponibilidad en el panel de administración.
- Notificará oportunamente a la Plataforma cualquier respuesta automatizada
  incorrecta detectada para su corrección.

useatiende.ai, su equipo y sus accionistas no serán responsables por:

- Daños directos, indirectos, incidentales o consecuentes derivados del uso
  o la imposibilidad de uso de la Plataforma por parte del consultorio o
  sus pacientes.
- Decisiones clínicas tomadas por el profesional con base en datos
  agregados por la Plataforma.
- Interpretaciones que el paciente haga de las respuestas automatizadas
  generadas por el asistente, fuera del alcance documentado en estos
  Términos.
- Interrupciones del servicio causadas por proveedores terceros
  (Meta/WhatsApp, Supabase, Vercel, OpenRouter, Upstash, Google Calendar).

### Sección recomendada: "Protección de Datos Personales (LFPDPPP)"

La Plataforma cumple con la Ley Federal de Protección de Datos Personales
en Posesión de los Particulares (LFPDPPP) mediante:

- **Cifrado de extremo a extremo en tránsito** (HTTPS/TLS 1.2+) y
  **cifrado AES-256-GCM en reposo** para el contenido de mensajes
  almacenados.
- **Aislamiento multi-tenant** vía Row-Level Security en PostgreSQL: los
  datos de cada consultorio son inaccesibles para otros consultorios.
- **Derecho de cancelación (Opt-Out)**: el paciente puede responder
  "BAJA", "STOP" o frases equivalentes para detener todas las
  comunicaciones automatizadas. La solicitud se respeta inmediatamente.
- **Derecho de supresión (ARCO-S)**: a solicitud del titular, la
  Plataforma elimina la totalidad de sus datos personales (mensajes,
  citas, contacto) en un plazo máximo de 20 días hábiles. Solicitar a
  ventas@useatiende.ai.
- **Retención limitada**: los mensajes se conservan por un máximo de 13
  meses (395 días) y luego son eliminados automáticamente vía cron job
  programado.

El responsable del tratamiento de datos es el consultorio que contrata la
Plataforma. useatiende.ai actúa como **encargado** del tratamiento de
datos en términos del Artículo 49 de la LFPDPPP.

### Sección recomendada: "Aviso de Privacidad para el Paciente"

Cuando un paciente interactúa con el asistente vía WhatsApp por primera vez,
debe recibir (idealmente, automáticamente al primer turno) el siguiente
aviso resumido:

> "Este es un asistente automatizado del [nombre del consultorio]. Tus
> mensajes se almacenan de forma cifrada para gestionar tus citas. Para
> dejar de recibir notificaciones, responde BAJA. Aviso de privacidad
> completo: [URL]"

---

## Plantilla técnica del bot (auto-disclaimer en cada conversación nueva)

Sugerencia: agregar al `welcome_message` del tenant (campo en
`tenants.welcome_message`):

```
Hola, soy el asistente automatizado del Dr. [NOMBRE].
Te ayudo a agendar y confirmar citas las 24h.

⚠️ Importante: NO doy diagnósticos ni recomiendo medicamentos.
Para consultas médicas el doctor te atenderá personalmente.
En urgencias marca 911.

Para dejar de recibir notificaciones responde BAJA.
```

---

## Recomendaciones operativas (no legales)

1. **Seguro de Errores y Omisiones (E&O)**:
   contratar póliza con cobertura mínima MXN 5,000,000 que incluya:
   - Errores de software (algoritmo)
   - Pérdida o filtración de datos
   - Defensa legal en juicios de pacientes
   - Aseguradoras a evaluar: AXA México, Mapfre, Qualitas, Chubb

2. **Auditoría externa de seguridad** (penetration test) anual antes de
   pasar de 50 consultorios activos.

3. **DPO (Delegado de Protección de Datos)**: designar uno una vez que
   se procesen >100,000 registros mensuales. Puede ser fraccional o
   subcontratado a despachos como Salinas y Lugo, Galicia Abogados, o
   Hogan Lovells México.

4. **Registro de tratamiento ante el INAI**: si la Plataforma maneja datos
   de salud (categoría sensible), debe registrar el tratamiento ante el
   Instituto Nacional de Transparencia, Acceso a la Información y
   Protección de Datos Personales (INAI) — gratis, online, ~30 días.

---

## Garantías técnicas implementadas (referencias al código)

Estas son evidencias de defensa que el abogado puede citar:

| Garantía | Archivo:línea | Comportamiento |
|---|---|---|
| No diagnóstico | `src/lib/guardrails/validate.ts:66-78` | Bloquea palabras de prescripción ("recomiendo tomar", "mg de", "apliquese", "podría ser un caso de") |
| No diagnóstico (prompt) | `src/lib/agents/agenda/prompt.ts:130` | "NUNCA des diagnósticos, recetas ni consejos médicos" |
| Disclaimer médico automático | `src/lib/guardrails/validate.ts:140-165` | `appendMedicalDisclaimer()` añade "Para consultas médicas el doctor le atenderá personalmente" cuando detecta query clínico |
| Crisis detection | `src/lib/guardrails/validate.ts:80-95` | Lista de palabras de crisis suicida + redirige a líneas de emergencia |
| Cifrado en reposo | `src/lib/utils/crypto.ts:21,68` | AES-256-GCM aplicado a `messages.content`, `media_transcription`, `media_description` |
| Multi-tenant isolation | `schema.sql:RLS` | Row-Level Security por `tenant_id` en todas las tablas |
| Opt-out (ARCO-O) | `src/lib/whatsapp/processor.ts:907` | Regex flexible que detecta "baja", "stop", "darme de baja por favor", etc. |
| Supresión (ARCO-S) | `src/app/api/user/delete-my-data/route.ts` | Endpoint que borra contact + messages + appointments + conversations |
| Retención limitada | `src/app/api/cron/data-retention/route.ts` | Cron semanal que elimina mensajes >395 días |
| HMAC verify webhooks | `src/app/api/webhook/whatsapp/route.ts:44-85` | Fail-secure 401 si firma inválida o secret no configurado |
| Anti-prompt injection | `src/lib/whatsapp/input-guardrail.ts` | Bloquea intentos de paciente de modificar el agente |

---

**Última actualización**: 2026-04-15
**Pendiente**: revisión por abogado mexicano (datos personales + responsabilidad civil sanitaria).
