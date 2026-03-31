export function conversationsToCSV(conversations: Array<{
  customer_name: string;
  customer_phone: string;
  status: string;
  created_at: string;
  last_message_at: string;
  tags: string[];
}>): string {
  const headers = 'Nombre,Teléfono,Estado,Inicio,Último Mensaje,Etiquetas\n';
  const rows = conversations.map(c =>
    `"${c.customer_name || ''}","${c.customer_phone}","${c.status}","${c.created_at}","${c.last_message_at}","${(c.tags || []).join(', ')}"`
  ).join('\n');
  return headers + rows;
}

export function messagesToCSV(messages: Array<{
  direction: string;
  sender_type: string;
  content: string;
  intent: string;
  model_used: string;
  created_at: string;
}>): string {
  const headers = 'Dirección,Tipo,Contenido,Intent,Modelo,Fecha\n';
  const rows = messages.map(m =>
    `"${m.direction}","${m.sender_type}","${(m.content || '').replace(/"/g, '""')}","${m.intent || ''}","${m.model_used || ''}","${m.created_at}"`
  ).join('\n');
  return headers + rows;
}
