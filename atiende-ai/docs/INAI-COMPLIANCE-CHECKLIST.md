# INAI Compliance Checklist — Atiende.ai

Status: **In Progress** | Last updated: 2026-04-22

This document tracks compliance with Mexico's LFPDPPP (Ley Federal de Protección de Datos Personales en Posesión de los Particulares) and the requirements of the INAI (Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos Personales).

## 1. Aviso de Privacidad (Privacy Notice)

| Requirement | Status | Notes |
|---|---|---|
| Full privacy notice on website | ⚠️ Partial | `/settings/privacy` page exists but content needs legal review |
| Simplified notice at point of collection | ⚠️ Draft | Bot auto-response mentions privacy but is not LFPDPPP-compliant |
| Identity of the data controller (responsable) | ❌ Missing | Must include legal name, RFC, address |
| Purpose of data processing (finalidades) | ⚠️ Draft | Listed in LEGAL_DISCLAIMER.md but not verified by lawyer |
| Data transfer disclosure | ❌ Missing | Must disclose OpenRouter, Supabase, Stripe, Meta transfers |
| ARCO-S rights exercise mechanism | ✅ Implemented | `/api/privacy/request-deletion` + signed token flow |
| Consent mechanism | ⚠️ Partial | Implied consent via WhatsApp interaction; explicit consent needed for sensitive data |
| Cookie notice | ❌ Missing | Dashboard uses cookies but no banner/notice |

## 2. INAI Registration

| Requirement | Status | Notes |
|---|---|---|
| Registration in INAI's Registro de Bases de Datos | ❌ Not started | Required if processing >100 individuals' data |
| Designation of privacy officer (persona responsable) | ❌ Not started | Must be a named individual with contact info |
| Internal privacy policy document | ❌ Not started | Separate from the public aviso de privacidad |
| Data processing inventory (inventario) | ⚠️ Partial | Schema.sql documents tables; formal inventory needed |

## 3. Technical Compliance

| Requirement | Status | Notes |
|---|---|---|
| Encryption at rest | ✅ Done | AES-256-GCM for messages, contacts, conversations |
| Encryption in transit | ✅ Done | HTTPS everywhere, HSTS enabled |
| Access controls | ✅ Done | RLS on all tables, tenant isolation |
| Audit trail for data access | ⚠️ Partial | webhook_logs exists; need general access audit log |
| Data deletion capability | ✅ Done | ARCO-S flow + tenant-initiated deletion |
| Data portability (export) | ✅ Done | `/api/export/conversations` endpoint |
| Data minimization | ⚠️ In progress | data-retention cron exists; review retention periods |
| Breach notification process | ❌ Missing | LFPDPPP requires notification within 72 hours |

## 4. ARCO-S Rights Implementation

| Right | Status | Endpoint |
|---|---|---|
| **A**cceso (Access) | ✅ Done | `/api/export/conversations` — tenant can export all data |
| **R**ectificación (Correction) | ⚠️ Partial | Dashboard edit for contacts; no patient-facing form |
| **C**ancelación (Deletion) | ✅ Done | `/api/privacy/request-deletion` + `/api/privacy/confirm-deletion` |
| **O**posición (Objection) | ❌ Missing | Patient should be able to opt-out of marketing/reminders |
| **S**upresión (Additional erasure) | ✅ Done | Same as Cancelación for our purposes |

## 5. Sensitive Data (Datos Sensibles)

Medical/health data is classified as "datos sensibles" under LFPDPPP and requires **explicit written consent**.

| Requirement | Status | Notes |
|---|---|---|
| Explicit consent for health data | ❌ Missing | Currently implied; need explicit opt-in at first WhatsApp interaction |
| Heightened security measures | ✅ Done | AES-256-GCM encryption, RLS, tenant isolation |
| Justified purpose for collection | ⚠️ Draft | Appointment scheduling is justified; storing diagnosis notes may not be |
| Special retention policies | ⚠️ Partial | data-retention cron exists; need health-specific retention period (NOM-004-SSA3: 5 years minimum for clinical records) |

## 6. Action Items (Priority Order)

1. **[CRITICAL]** Engage a Mexican privacy lawyer to review LEGAL_DISCLAIMER.md and draft a compliant Aviso de Privacidad
2. **[CRITICAL]** Register with INAI's Registro de Bases de Datos
3. **[HIGH]** Implement explicit consent flow for health data at first WhatsApp interaction
4. **[HIGH]** Add data transfer disclosure (list all third-party processors)
5. **[HIGH]** Designate a privacy officer and publish contact info
6. **[MEDIUM]** Implement Oposición right (opt-out of marketing messages)
7. **[MEDIUM]** Create breach notification playbook
8. **[MEDIUM]** Add cookie consent banner to dashboard
9. **[LOW]** Patient-facing Rectificación form
10. **[LOW]** Formal data processing inventory document

## 7. Regulatory References

- [LFPDPPP Full Text](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf)
- [INAI Registration Portal](https://home.inai.org.mx/)
- [NOM-004-SSA3-2012](https://www.dof.gob.mx/nota_detalle.php?codigo=5272787) — Clinical records retention
- [Lineamientos del Aviso de Privacidad](https://www.dof.gob.mx/nota_detalle.php?codigo=5284966)
