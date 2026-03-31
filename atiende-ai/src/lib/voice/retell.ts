import axios from 'axios';

const RETELL = 'https://api.retellai.com/v2';
const headers = () => ({
  Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
  'Content-Type': 'application/json',
});

// Crear agente de voz para un tenant
export async function createRetellAgent(tenant: {
  name: string;
  voice_system_prompt?: string;
  elevenlabs_voice_id?: string;
  config?: Record<string, unknown>;
}) {
  const { data } = await axios.post(`${RETELL}/create-agent`, {
    agent_name: `${tenant.name} - Voz`,
    voice_id: tenant.elevenlabs_voice_id || 'JBFqnCBsd6RMkjVDRZzb',
    language: 'es',
    response_engine: { type: 'retell-llm', llm_id: 'gpt-4o' },
    general_prompt: tenant.voice_system_prompt || '',
    begin_message:
      `Hola, gracias por llamar a ${tenant.name}. ` +
      'Con mucho gusto le atiendo. En que le puedo ayudar?',
    general_tools: [
      { type: 'end_call', name: 'end_call',
        description: 'Terminar la llamada cuando se resolvio' },
      { type: 'transfer_call', name: 'transfer_human',
        description: 'Transferir a humano si lo solicita o emergencia',
        number: tenant.config?.human_phone || '' },
    ],
    enable_backchannel: true,
    backchannel_words: ['si', 'aja', 'claro', 'entendido', 'mmhm'],
    responsiveness: 0.8,
    interruption_sensitivity: 0.6,
    ambient_sound: null,
    webhook_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/retell`,
  }, { headers: headers() });

  return data; // { agent_id: '...', ... }
}

// Hacer llamada outbound (para campanas, recordatorios)
export async function makeOutboundCall(
  agentId: string, toNumber: string,
  metadata?: Record<string, string>
) {
  const { data } = await axios.post(
    `${RETELL}/create-phone-call`,
    {
      from_number: process.env.TELNYX_PHONE_NUMBER,
      to_number: toNumber,
      agent_id: agentId,
      metadata,
    },
    { headers: headers() }
  );
  return data;
}

// Obtener detalles de una llamada
export async function getCallDetails(callId: string) {
  const { data } = await axios.get(
    `${RETELL}/get-call/${callId}`,
    { headers: headers() }
  );
  return data;
}

// Actualizar prompt del agente (sin recrear)
export async function updateAgentPrompt(
  agentId: string, newPrompt: string
) {
  const { data } = await axios.patch(
    `${RETELL}/update-agent/${agentId}`,
    { general_prompt: newPrompt },
    { headers: headers() }
  );
  return data;
}
