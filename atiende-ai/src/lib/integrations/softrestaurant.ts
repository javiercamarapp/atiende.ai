import axios from 'axios';

const SR_API = process.env.SOFTRESTAURANT_API_URL || 'https://api.softrestaurant.com.mx';
const SR_KEY = process.env.SOFTRESTAURANT_API_KEY;

// Obtener menú del restaurante desde SoftRestaurant
export async function getMenuFromSR(): Promise<any[]> {
  if (!SR_KEY) return [];
  try {
    const { data } = await axios.get(`${SR_API}/api/menu`, {
      headers: { AuthorizedApp: SR_KEY },
    });
    return data.menu || data || [];
  } catch (e) {
    console.error('SoftRestaurant menu fetch error:', e);
    return [];
  }
}

// Enviar pedido a SoftRestaurant POS
export async function sendOrderToSR(order: {
  items: { name: string; qty: number; price: number }[];
  customerName: string;
  orderType: 'delivery' | 'pickup' | 'dine_in';
  notes?: string;
}) {
  if (!SR_KEY) return null;
  try {
    const { data } = await axios.post(`${SR_API}/api/orders`, {
      items: order.items.map(i => ({
        producto: i.name,
        cantidad: i.qty,
        precio: i.price,
      })),
      cliente: order.customerName,
      tipo: order.orderType === 'delivery' ? 'domicilio' :
            order.orderType === 'pickup' ? 'para_llevar' : 'en_sitio',
      notas: order.notes,
    }, {
      headers: { AuthorizedApp: SR_KEY, 'Content-Type': 'application/json' },
    });
    return data;
  } catch (e) {
    console.error('SoftRestaurant order error:', e);
    return null;
  }
}

// Sync menú → RAG knowledge base
export async function syncMenuToRAG(tenantId: string) {
  const menu = await getMenuFromSR();
  if (!menu.length) return;

  const { ingestKnowledge } = await import('@/lib/rag/search');
  const { supabaseAdmin } = await import('@/lib/supabase/admin');

  // Borrar chunks de menú viejos
  await supabaseAdmin.from('knowledge_chunks').delete()
    .eq('tenant_id', tenantId).eq('category', 'menu');

  // Ingestar menú actualizado
  const menuText = 'MENÚ COMPLETO:\n' +
    menu.map((item: any) =>
      `${item.nombre || item.name} - $${item.precio || item.price} MXN` +
      (item.descripcion ? ` (${item.descripcion})` : '')
    ).join('\n');

  await ingestKnowledge(tenantId, menuText, 'menu');
  return menu.length;
}
