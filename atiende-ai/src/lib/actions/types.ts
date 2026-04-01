// ═══════════════════════════════════════════════════════════
// SHARED ACTION TYPES — Used by engine.ts & insurance-handlers.ts
// ═══════════════════════════════════════════════════════════

export interface ActionContext {
  tenantId: string
  phoneNumberId: string
  customerPhone: string
  customerName: string
  contactId: string
  conversationId: string
  intent: string
  content: string
  businessType: string
  tenant: Record<string, unknown>
}

export interface ActionResult {
  actionTaken: boolean
  actionType?: string
  details?: Record<string, unknown>
  followUpMessage?: string
}
