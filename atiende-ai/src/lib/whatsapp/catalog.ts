import axios from 'axios';

const WA_API = 'https://graph.facebook.com/v21.0';

export async function syncCatalogItems(phoneNumberId: string, items: Array<{
  name: string;
  price: number;
  description?: string;
  imageUrl?: string;
  category?: string;
}>) {
  const catalogRes = await axios.get(
    `${WA_API}/${phoneNumberId}/catalogs`,
    { headers: { Authorization: `Bearer ${process.env.WA_SYSTEM_TOKEN}` } }
  );

  const catalogId = catalogRes.data?.data?.[0]?.id;
  if (!catalogId) return { synced: 0, error: 'No catalog found' };

  let synced = 0;
  for (const item of items) {
    try {
      await axios.post(
        `${WA_API}/${catalogId}/products`,
        {
          name: item.name,
          price: Math.round(item.price * 100),
          currency: 'MXN',
          description: item.description || '',
          url: item.imageUrl,
          category: item.category || 'other',
        },
        { headers: { Authorization: `Bearer ${process.env.WA_SYSTEM_TOKEN}` } }
      );
      synced++;
    } catch {
      // Continue on individual item failure
    }
  }

  return { synced, total: items.length };
}

export async function sendProductMessage(
  phoneNumberId: string,
  to: string,
  catalogId: string,
  productIds: string[],
  headerText: string,
  bodyText: string,
) {
  await axios.post(
    `${WA_API}/${phoneNumberId}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: productIds.length === 1 ? 'product' : 'product_list',
        header: { type: 'text', text: headerText },
        body: { text: bodyText },
        action: productIds.length === 1
          ? { catalog_id: catalogId, product_retailer_id: productIds[0] }
          : {
              catalog_id: catalogId,
              sections: [{
                title: 'Nuestros productos',
                product_items: productIds.map(id => ({ product_retailer_id: id })),
              }],
            },
      },
    },
    { headers: { Authorization: `Bearer ${process.env.WA_SYSTEM_TOKEN}` } }
  );
}
