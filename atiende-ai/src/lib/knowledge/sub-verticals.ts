// Sub-verticals — tags that refine a business_type for smart-insight
// benchmarking. A dental clinic may be 'orthodontics' + 'family', a restaurant
// 'taqueria' + 'delivery'. Used as additional signal for insight_cache key
// and for benchmark prompt selection.

export const SUB_VERTICALS: Record<string, string[]> = {
  dental:        ['general', 'orthodontics', 'endodontics', 'implants', 'cosmetic', 'pediatric', 'family'],
  medical:       ['general', 'family', 'internal', 'urgent_care'],
  restaurant:    ['casual', 'fine_dining', 'fast_food', 'taqueria', 'cafe', 'bar', 'delivery'],
  salon:         ['hair', 'nails', 'full_service', 'bridal'],
  hotel:         ['business', 'boutique', 'resort', 'budget'],
  veterinary:    ['general', 'exotic', 'surgery', 'emergency'],
  barbershop:    ['classic', 'modern', 'premium'],
  cafe:          ['specialty', 'bakery', 'brunch'],
  spa:           ['day_spa', 'medical', 'wellness'],
  pharmacy:      ['retail', 'compounding', 'specialty'],
  school:        ['preschool', 'elementary', 'secondary', 'highschool', 'language'],
  insurance:     ['auto', 'health', 'home', 'life', 'business'],
  mechanic:      ['general', 'specialized', 'body_shop'],
  accountant:    ['personal', 'business', 'tax'],
  florist:       ['retail', 'events', 'bridal'],
  optics:        ['eyewear', 'contacts', 'sunglasses'],
  gym:           ['traditional', 'crossfit', 'boutique', 'personal_training'],
  nutritionist:  ['weight', 'sports', 'clinical'],
  dermatologist: ['clinical', 'cosmetic', 'pediatric'],
  gynecologist:  ['general', 'fertility', 'obstetrics'],
  pediatrician:  ['general', 'neonatal'],
  ophthalmologist: ['general', 'surgical', 'pediatric'],
  taqueria:      ['tradicional', 'gourmet', 'delivery'],
  real_estate:   ['residential', 'commercial', 'rental'],
  psychologist:  ['adult', 'couples', 'child', 'family', 'online'],
};

export function getSubVerticalsFor(businessType: string): string[] {
  return SUB_VERTICALS[businessType] ?? [];
}

export function isValidSubVertical(businessType: string, sub: string): boolean {
  return (SUB_VERTICALS[businessType] ?? []).includes(sub);
}
