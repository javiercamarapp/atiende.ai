const POSITIVE_WORDS = ['gracias', 'excelente', 'perfecto', 'genial', 'bueno', 'encanta', 'super', 'maravilloso', 'recomiendo'];
const NEGATIVE_WORDS = ['malo', 'pésimo', 'terrible', 'queja', 'molesto', 'enojado', 'nunca', 'peor', 'horrible', 'estafa'];
const URGENT_WORDS = ['urgente', 'emergencia', 'ya', 'ahora', 'inmediato', 'rápido', 'dolor', 'sangre'];

export function analyzeSentiment(text: string): { score: number; label: 'positive' | 'neutral' | 'negative'; urgent: boolean } {
  const lower = text.toLowerCase();
  let score = 0;

  POSITIVE_WORDS.forEach(w => { if (lower.includes(w)) score += 1; });
  NEGATIVE_WORDS.forEach(w => { if (lower.includes(w)) score -= 1; });
  const urgent = URGENT_WORDS.some(w => lower.includes(w));

  return {
    score,
    label: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral',
    urgent,
  };
}
