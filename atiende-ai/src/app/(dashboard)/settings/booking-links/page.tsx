import { createServerSupabase } from '@/lib/supabase/server';
import { BookingLinksManager } from '@/components/dashboard/booking-links-manager';

export default async function BookingLinksPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name')
    .eq('user_id', user!.id)
    .single();

  const { data: staff } = await supabase
    .from('staff')
    .select('id, name, role')
    .eq('tenant_id', tenant!.id)
    .eq('active', true)
    .order('name');

  const { data: links } = await supabase
    .from('public_booking_links')
    .select('id, slug, staff_id, enabled, monthly_bookings_cap, link_expires_at, heading, subheading, brand_color_hex, created_at, last_booking_at')
    .eq('tenant_id', tenant!.id)
    .order('created_at', { ascending: false });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';

  return (
    <BookingLinksManager
      tenantName={tenant!.name as string}
      baseUrl={baseUrl}
      staff={(staff || []) as Array<{ id: string; name: string; role: string | null }>}
      initialLinks={(links || []) as Array<{
        id: string; slug: string; staff_id: string | null; enabled: boolean;
        monthly_bookings_cap: number; link_expires_at: string | null;
        heading: string | null; subheading: string | null; brand_color_hex: string | null;
        created_at: string; last_booking_at: string | null;
      }>}
    />
  );
}
