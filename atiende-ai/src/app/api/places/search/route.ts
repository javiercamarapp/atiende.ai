import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { z } from 'zod';
import { createServerSupabase } from '@/lib/supabase/server';

const SearchSchema = z.object({
  query: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (!user || authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { checkApiRateLimit } = await import('@/lib/api-rate-limit');
    if (await checkApiRateLimit(`${user.id}:places_search`, 10, 60)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const body = await req.json();
    const parsed = SearchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
    }

    const { query } = parsed.data;

    const { data } = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', {
      params: { query, key: process.env.GOOGLE_MAPS_API_KEY, language: 'es', region: 'mx' },
    });

    if (data.results?.[0]) {
      const p = data.results[0];
      const { data: d } = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
        params: {
          place_id: p.place_id,
          fields: 'formatted_address,formatted_phone_number,website,rating,geometry',
          key: process.env.GOOGLE_MAPS_API_KEY,
          language: 'es',
        },
      });
      const r = d.result || {};
      return NextResponse.json({
        result: {
          address: r.formatted_address,
          phone: r.formatted_phone_number,
          website: r.website,
          rating: r.rating,
          lat: r.geometry?.location?.lat,
          lng: r.geometry?.location?.lng,
        },
      });
    }

    return NextResponse.json({ result: null });
  } catch {
    return NextResponse.json({ error: 'Failed to search places' }, { status: 500 });
  }
}
