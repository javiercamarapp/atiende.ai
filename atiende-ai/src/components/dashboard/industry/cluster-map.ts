// Maps the 26 DB business_type values to 6 dashboard clusters.
// Each cluster gets its own dashboard home layout with specialized widgets.

export type DashboardCluster =
  | 'salud'
  | 'gastronomia'
  | 'hospedaje'
  | 'belleza'
  | 'retail'
  | 'servicios';

export const CLUSTER_MAP: Record<string, DashboardCluster> = {
  // Salud (10)
  dental: 'salud',
  medical: 'salud',
  nutritionist: 'salud',
  psychologist: 'salud',
  dermatologist: 'salud',
  gynecologist: 'salud',
  pediatrician: 'salud',
  ophthalmologist: 'salud',
  pharmacy: 'salud',
  veterinary: 'salud',
  // Gastronomia (4)
  restaurant: 'gastronomia',
  taqueria: 'gastronomia',
  cafe: 'gastronomia',
  florist: 'gastronomia', // florist orders behave like food orders
  // Hospedaje (1 DB type, covers 6 verticals)
  hotel: 'hospedaje',
  // Belleza (5)
  salon: 'belleza',
  barbershop: 'belleza',
  spa: 'belleza',
  gym: 'belleza',
  optics: 'belleza',
  // Servicios (5)
  real_estate: 'servicios',
  insurance: 'servicios',
  school: 'servicios',
  mechanic: 'servicios',
  accountant: 'servicios',
  // Retail catch-all
  other: 'retail',
};

export function getCluster(businessType: string): DashboardCluster {
  return CLUSTER_MAP[businessType] ?? 'retail';
}

export const CLUSTER_LABELS: Record<DashboardCluster, string> = {
  salud: 'Salud',
  gastronomia: 'Gastronomia',
  hospedaje: 'Hospedaje',
  belleza: 'Belleza & Lifestyle',
  retail: 'Comercio',
  servicios: 'Servicios Profesionales',
};
