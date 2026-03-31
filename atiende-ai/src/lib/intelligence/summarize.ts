import { generateResponse, MODELS } from '@/lib/llm/openrouter';

export async function summarizeConversation(messages: Array<{ direction: string; content: string }>): Promise<string> {
  const transcript = messages.map(m =>
    `${m.direction === 'inbound' ? 'Cliente' : 'Bot'}: ${m.content}`
  ).join('\n');

  const result = await generateResponse({
    model: MODELS.STANDARD,
    system: 'Resume esta conversación en 2-3 oraciones en español. Incluye: qué pidió el cliente, qué se resolvió, y si hay pendientes.',
    messages: [{ role: 'user', content: transcript }],
    temperature: 0.3,
    maxTokens: 200,
  });

  return result.text;
}
