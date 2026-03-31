// Webhook receiver para Rappi/UberEats/Didi
// Estos servicios envían pedidos por webhook cuando un cliente ordena

export function parseRappiOrder(payload: Record<string, unknown>) {
  const order = payload.order as Record<string, unknown> | undefined;
  const customer = order?.customer as Record<string, unknown> | undefined;
  const deliveryAddress = order?.delivery_address as Record<string, unknown> | undefined;
  const items = (order?.items || []) as Record<string, unknown>[];
  return {
    platform: 'rappi' as const,
    orderId: order?.id as string | undefined,
    items: items.map((i) => ({
      name: i.name as string, qty: i.quantity as number, price: i.price as number,
    })),
    customerName: (customer?.name as string) || 'Cliente Rappi',
    customerPhone: customer?.phone as string | undefined,
    total: order?.total as number | undefined,
    deliveryAddress: deliveryAddress?.address as string | undefined,
    estimatedDelivery: order?.estimated_delivery_time as string | undefined,
  };
}

export function parseUberEatsOrder(payload: Record<string, unknown>) {
  const cart = payload.cart as Record<string, unknown> | undefined;
  const eater = payload.eater as Record<string, unknown> | undefined;
  const cartItems = (cart?.items || []) as Record<string, unknown>[];
  const cartTotal = cart?.total as Record<string, unknown> | undefined;
  return {
    platform: 'uber_eats' as const,
    orderId: payload.id as string | undefined,
    items: cartItems.map((i) => ({
      name: i.title as string, qty: i.quantity as number, price: ((i.price as Record<string, unknown>)?.amount as number) / 100,
    })),
    customerName: (eater?.first_name as string) || 'Cliente Uber Eats',
    total: (cartTotal?.amount as number) / 100,
  };
}

export function parseDidiOrder(payload: Record<string, unknown>) {
  const orderItems = (payload.orderItems || []) as Record<string, unknown>[];
  return {
    platform: 'didi_food' as const,
    orderId: payload.orderId as string | undefined,
    items: orderItems.map((i) => ({
      name: i.itemName as string, qty: i.quantity as number, price: i.itemPrice as number,
    })),
    customerName: (payload.customerName as string) || 'Cliente Didi',
    total: payload.totalAmount as number | undefined,
  };
}
