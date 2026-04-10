// Cluster map — PIVOTE: solo dental + restaurante.
// Maps DB business_type to dashboard component key.

export type DashboardCluster = 'dental' | 'restaurante';

export const CLUSTER_MAP: Record<string, DashboardCluster> = {
  dental: 'dental',
  restaurant: 'restaurante',
  taqueria: 'restaurante',
  cafe: 'restaurante',
};

export function getCluster(businessType: string): DashboardCluster | null {
  return CLUSTER_MAP[businessType] ?? null;
}
