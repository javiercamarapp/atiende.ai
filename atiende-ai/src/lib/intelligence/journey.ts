export interface CustomerJourney {
  firstContact: string;
  totalMessages: number;
  totalAppointments: number;
  totalOrders: number;
  totalSpend: number;
  lastContact: string;
  averageResponseTime: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  lifetime: number; // days
  stage: 'new' | 'active' | 'loyal' | 'at-risk' | 'churned';
}

export function calculateStage(lastContactDays: number, totalInteractions: number): CustomerJourney['stage'] {
  if (lastContactDays > 90) return 'churned';
  if (lastContactDays > 30) return 'at-risk';
  if (totalInteractions > 10) return 'loyal';
  if (totalInteractions > 2) return 'active';
  return 'new';
}
