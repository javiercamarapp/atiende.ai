// Webhook receiver para Rappi/UberEats/Didi
// Estos servicios envían pedidos por webhook cuando un cliente ordena

export function parseRappiOrder(payload: any) {
  return {
    platform: 'rappi' as const,
    orderId: payload.order?.id,
    items: (payload.order?.items || []).map((i: any) => ({
      name: i.name, qty: i.quantity, price: i.price,
    })),
    customerName: payload.order?.customer?.name || 'Cliente Rappi',
    customerPhone: payload.order?.customer?.phone,
    total: payload.order?.total,
    deliveryAddress: payload.order?.delivery_address?.address,
    estimatedDelivery: payload.order?.estimated_delivery_time,
  };
}

export function parseUberEatsOrder(payload: any) {
  return {
    platform: 'uber_eats' as const,
    orderId: payload.id,
    items: (payload.cart?.items || []).map((i: any) => ({
      name: i.title, qty: i.quantity, price: i.price?.amount / 100,
    })),
    customerName: payload.eater?.first_name || 'Cliente Uber Eats',
    total: payload.cart?.total?.amount / 100,
  };
}

export function parseDidiOrder(payload: any) {
  return {
    platform: 'didi_food' as const,
    orderId: payload.orderId,
    items: (payload.orderItems || []).map((i: any) => ({
      name: i.itemName, qty: i.quantity, price: i.itemPrice,
    })),
    customerName: payload.customerName || 'Cliente Didi',
    total: payload.totalAmount,
  };
}
