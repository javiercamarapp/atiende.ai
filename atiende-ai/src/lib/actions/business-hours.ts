// ═══════════════════════════════════════════════════════════
// BUSINESS HOURS — Check if open/closed for after-hours interception
// ═══════════════════════════════════════════════════════════

export function isBusinessOpen(businessHours: Record<string, string> | null, timezone = 'America/Merida'): boolean {
  if (!businessHours) return true; // Default to open if no hours set

  const now = new Date();
  // Simple timezone offset for Mexico (UTC-6 or UTC-5 depending on DST)
  const days = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const dayKey = days[now.getDay()];
  const todayHours = businessHours[dayKey];

  if (!todayHours || todayHours === 'cerrado') return false;

  const [open, close] = todayHours.split('-');
  if (!open || !close) return true;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = open.split(':').map(Number);
  const [closeH, closeM] = close.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
}

export function getNextOpenTime(businessHours: Record<string, string> | null): string {
  if (!businessHours) return '09:00';

  const days = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const now = new Date();

  // Check next 7 days
  for (let i = 1; i <= 7; i++) {
    const nextDay = new Date(now.getTime() + i * 86400000);
    const dayKey = days[nextDay.getDay()];
    const hours = businessHours[dayKey];
    if (hours && hours !== 'cerrado') {
      const dayName = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][nextDay.getDay()];
      return `${dayName} a las ${hours.split('-')[0]}`;
    }
  }

  return 'pronto';
}
