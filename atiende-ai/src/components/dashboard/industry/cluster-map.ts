// Cluster map — 2 service types: CITAS and PEDIDOS.
// 22 active verticals map to one of these two dashboards.
// Everything else → null (waitlist).

export type DashboardCluster = 'citas' | 'pedidos';

export const CLUSTER_MAP: Record<string, DashboardCluster> = {
  // CITAS — salud (10)
  dental: 'citas',
  medical: 'citas',
  nutritionist: 'citas',
  psychologist: 'citas',
  dermatologist: 'citas',
  gynecologist: 'citas',
  pediatrician: 'citas',
  ophthalmologist: 'citas',
  pharmacy: 'citas',
  veterinary: 'citas',
  // CITAS — belleza (6)
  salon: 'citas',
  barbershop: 'citas',
  spa: 'citas',
  gym: 'citas',
  optics: 'citas',
  // PEDIDOS — gastronomia (6)
  restaurant: 'pedidos',
  taqueria: 'pedidos',
  cafe: 'pedidos',
};

export function getCluster(businessType: string): DashboardCluster | null {
  return CLUSTER_MAP[businessType] ?? null;
}
