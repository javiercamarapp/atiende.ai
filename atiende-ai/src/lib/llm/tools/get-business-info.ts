// ═════════════════════════════════════════════════════════════════════════════
// TOOL: get_business_info
//
// Devuelve la info estática del negocio que el LLM necesita para responder
// preguntas tipo "¿dónde están?", "¿qué horario tienen?", "¿cómo los contacto?"
// SIN llamar a más LLM ni hacer multiple round trips.
// ═════════════════════════════════════════════════════════════════════════════

import { z } from 'zod';
import { registerTool, type ToolContext } from '@/lib/llm/tool-executor';

const argsSchema = z.object({}).strict();

interface BusinessInfo {
  name: string;
  address?: string;
  city?: string;
  state?: string;
  phone?: string;
  website?: string;
  business_hours?: Record<string, string>;
  timezone: string;
  is_open_now: boolean;
}

function isOpenNow(
  hours: Record<string, string> | null | undefined,
  timezone: string,
): boolean {
  if (!hours) return true;
  const days = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const dtfDay = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const dtfTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const now = new Date();
  const weekdayMap: Record<string, string> = {
    sun: 'dom', mon: 'lun', tue: 'mar', wed: 'mie', thu: 'jue', fri: 'vie', sat: 'sab',
  };
  const dayKey = weekdayMap[dtfDay.format(now).toLowerCase()] || days[now.getDay()];
  const todayHours = hours[dayKey];
  if (!todayHours || todayHours === 'cerrado') return false;
  const [open, close] = todayHours.split('-');
  if (!open || !close) return false;
  const [ch, cm] = dtfTime.format(now).split(':').map(Number);
  const [oh, om] = open.split(':').map(Number);
  const [clh, clm] = close.split(':').map(Number);
  const cMin = ch * 60 + cm;
  return cMin >= oh * 60 + om && cMin <= clh * 60 + clm;
}

async function handler(_args: unknown, ctx: ToolContext): Promise<BusinessInfo> {
  argsSchema.parse(_args ?? {}); // valida que no llegan args extras
  const t = ctx.tenant;
  const timezone = (t.timezone as string) || 'America/Merida';
  const hours = t.business_hours as Record<string, string> | undefined;
  return {
    name: (t.name as string) || '',
    address: t.address as string | undefined,
    city: t.city as string | undefined,
    state: t.state as string | undefined,
    phone: t.phone as string | undefined,
    website: t.website as string | undefined,
    business_hours: hours,
    timezone,
    is_open_now: isOpenNow(hours, timezone),
  };
}

registerTool('get_business_info', {
  schema: {
    type: 'function',
    function: {
      name: 'get_business_info',
      description:
        'Devuelve información estática del negocio: nombre, dirección, teléfono, horario semanal, sitio web, zona horaria, y si está abierto AHORA. Usa esto para responder preguntas de horario, ubicación o contacto. NO requiere argumentos.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  handler,
});
