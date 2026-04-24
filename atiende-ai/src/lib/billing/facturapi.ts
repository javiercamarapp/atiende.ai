// ═════════════════════════════════════════════════════════════════════════════
// Facturapi client (Phase 2.D)
//
// Facturapi (https://facturapi.io) es SaaS mexicano que expone API REST para
// generar CFDI 4.0 firmados ante SAT. El tenant configura su API key en
// tenants.facturapi_api_key y nosotros la usamos server-side.
//
// Alternativas:
//   - SAT directo: requiere certificado .cer + llave .key + PAC intermedio.
//     Muy complejo para un SaaS multi-tenant.
//   - Otros PACs (Quadrum, Diverza): API parecida, pero Facturapi tiene la
//     mejor DX y documentación.
//
// Nota: Facturapi es para CFDI fiscales (facturas de la consulta). NO es
// para recetas médicas digitales — eso es un PDF firmado aparte (NOM-004)
// que se puede hacer client-side con pdf-lib + firma del doctor.
// ═════════════════════════════════════════════════════════════════════════════

interface CreateInvoiceInput {
  apiKey: string;
  /** RFC del receptor (paciente o su empresa) */
  receiverRfc: string;
  receiverName?: string;
  receiverEmail?: string;
  receiverPostalCode?: string;
  receiverTaxSystem?: string;   // régimen fiscal del receptor, ej. '612'
  /** CFDI use — G03 default, D01 para honorarios médicos */
  cfdiUse: string;
  /** Monto en MXN (será × 100 para centavos en el request si aplica) */
  amountMxn: number;
  /** Descripción corta del servicio, ej. "Consulta dental 15/abr/2026" */
  description: string;
  /** SAT product code. 85121500 = servicios médicos. */
  productKey?: string;
  /** Idempotency key para evitar doble-emisión si el cron reintenta. */
  idempotencyKey: string;
}

interface FacturapiInvoice {
  id: string;
  uuid: string;      // Folio fiscal del SAT
  xml: string;       // URL al XML firmado
  pdf: string;       // URL al PDF
  status: string;
}

const BASE_URL = 'https://www.facturapi.io/v2';

/**
 * Crea un CFDI 4.0 en Facturapi. Si el request falla por validación fiscal
 * (RFC inválido, RFC no existe en SAT, etc) devuelve {ok:false, error}
 * sin lanzar. Si hay network/5xx, lanza para que el caller pueda reintentar.
 */
export async function createCfdiInvoice(input: CreateInvoiceInput): Promise<
  | { ok: true; invoice: FacturapiInvoice }
  | { ok: false; error: string; retriable: boolean }
> {
  const productKey = input.productKey || '85121500'; // servicios médicos

  const body = {
    customer: {
      legal_name: input.receiverName || input.receiverRfc,
      email: input.receiverEmail,
      tax_id: input.receiverRfc,
      tax_system: input.receiverTaxSystem || '612',
      address: input.receiverPostalCode ? { zip: input.receiverPostalCode } : undefined,
    },
    items: [
      {
        quantity: 1,
        product: {
          description: input.description.slice(0, 250),
          product_key: productKey,
          price: input.amountMxn,
          tax_included: true,
        },
      },
    ],
    use: input.cfdiUse,
    payment_form: '99', // "Por definir" — el tenant lo ajusta desde Facturapi dashboard si quiere especificar
    send_by_email: Boolean(input.receiverEmail),
  };

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'network_error',
      retriable: true,
    };
  }

  if (res.status >= 500) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `facturapi_5xx: ${text.slice(0, 200)}`, retriable: true };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `facturapi_${res.status}: ${text.slice(0, 200)}`, retriable: false };
  }

  const data = (await res.json()) as {
    id?: string;
    uuid?: string;
    status?: string;
    [k: string]: unknown;
  };
  if (!data.id || !data.uuid) {
    return { ok: false, error: 'facturapi_missing_fields', retriable: false };
  }
  return {
    ok: true,
    invoice: {
      id: data.id,
      uuid: data.uuid,
      xml: `${BASE_URL}/invoices/${data.id}/xml`,
      pdf: `${BASE_URL}/invoices/${data.id}/pdf`,
      status: data.status || 'issued',
    },
  };
}
