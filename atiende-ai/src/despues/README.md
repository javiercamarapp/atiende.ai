# src/despues/ — Verticales para después

Este folder contiene código de verticales que **NO están activas** en el MVP actual de atiende.ai.

## Estrategia actual

atiende.ai v1 se enfoca **exclusivamente en agentes de reservas** para los sectores de **Salud** y **Estética** — todos aquellos negocios cuyo pilar operativo es el dashboard de **Citas**.

### Verticales ACTIVAS (en `src/lib/verticals/`)

**Salud (9):** dental, medico, nutriologa, psicologo, dermatologo, ginecologo, pediatra, oftalmologo, veterinaria

**Belleza / Estética (6):** salon_belleza, barberia, spa, gimnasio, nail_salon, estetica

### Verticales en STANDBY (aquí en `src/despues/`)

Estos verticales se reactivarán en futuras iteraciones del producto:

- **Salud pero no-citas:** farmacia
- **Gastronomía:** restaurante, taqueria, cafeteria, panaderia, bar_cantina, food_truck
- **Hospedaje y Turismo:** hotel, hotel_boutique, motel, glamping, bb_hostal, resort
- **Comercios y Retail:** floreria, tienda_ropa, papeleria, ferreteria, abarrotes, libreria, joyeria, jugueteria, zapateria
- **Servicios Profesionales:** contable_legal, seguros, taller_mecanico, escuela, agencia_digital, fotografo, condominio

## Cómo reactivar un vertical

Cuando se decida reactivar uno (o varios) de estos verticales:

1. Mover el archivo de vuelta a `src/lib/verticals/questions/` y `src/lib/verticals/metadata/`
2. Agregar el import correspondiente en `src/lib/verticals/index.ts`
3. Agregar el(los) enum(s) del vertical al array `ACTIVE_VERTICALS` en `src/lib/verticals/index.ts`
4. Validar con `npm run type-check` y `npm run test`

## Comportamiento en onboarding

El agente conversacional de onboarding (**Valeria**, en `src/lib/onboarding/chat-agent.ts`) solo ofrece los verticales ACTIVOS. Si un usuario describe un negocio que cae en una vertical en standby, Valeria responde con un mensaje formal indicando que atiende.ai por ahora solo cubre salud/estética e invita a dejar contacto para avisar cuando su sector esté disponible.
