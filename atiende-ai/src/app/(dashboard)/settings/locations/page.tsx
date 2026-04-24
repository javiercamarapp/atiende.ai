import { createServerSupabase } from '@/lib/supabase/server';
import { LocationsManager } from '@/components/dashboard/locations-manager';

export default async function LocationsPage() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: tenant } = await supabase
    .from('tenants').select('id, name, timezone').eq('user_id', user!.id).single();

  const [{ data: locations }, { data: staff }] = await Promise.all([
    supabase
      .from('locations')
      .select('*')
      .eq('tenant_id', tenant!.id)
      .order('is_primary', { ascending: false })
      .order('name'),
    supabase
      .from('staff')
      .select('id, name, role, active')
      .eq('tenant_id', tenant!.id)
      .order('name'),
  ]);

  const locationIds = (locations || []).map((l) => l.id as string);
  const { data: staffLocs } = locationIds.length
    ? await supabase.from('staff_locations').select('staff_id, location_id').in('location_id', locationIds)
    : { data: [] };

  const byLocation: Record<string, string[]> = {};
  for (const sl of staffLocs || []) {
    const lid = sl.location_id as string;
    if (!byLocation[lid]) byLocation[lid] = [];
    byLocation[lid].push(sl.staff_id as string);
  }

  const enriched = (locations || []).map((l) => ({
    ...l,
    staff_ids: byLocation[l.id as string] || [],
  }));

  return (
    <LocationsManager
      tenantTimezone={(tenant!.timezone as string) || 'America/Mexico_City'}
      staff={(staff || []) as Array<{ id: string; name: string; role: string | null; active: boolean }>}
      initialLocations={enriched as Array<{
        id: string;
        name: string;
        address: string | null; city: string | null; state: string | null; postal_code: string | null;
        country: string | null; lat: number | null; lng: number | null;
        google_place_id: string | null; phone: string | null;
        timezone: string | null;
        business_hours: Record<string, string> | null;
        is_primary: boolean; active: boolean;
        staff_ids: string[];
      }>}
    />
  );
}
