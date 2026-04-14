/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock setup (hoisted) ───────────────────────────────────

const {
  mockGenerateResponse,
  mockSendTextMessage,
  mockSetConversationState,
  mockGetConversationState,
  mockClearConversationState,
  mockExecuteEventAgents,
  mockCreateCalendarEvent,
  mockCancelCalendarEvent,
  mockFrom,
} = vi.hoisted(() => {
  const mockFrom = vi.fn();
  return {
    mockGenerateResponse: vi.fn(),
    mockSendTextMessage: vi.fn(),
    mockSetConversationState: vi.fn(),
    mockGetConversationState: vi.fn(async () => ({ state: null, context: {} })),
    mockClearConversationState: vi.fn(),
    mockExecuteEventAgents: vi.fn(),
    mockCreateCalendarEvent: vi.fn(),
    mockCancelCalendarEvent: vi.fn(),
    mockFrom,
  };
});

// ── Mock external modules ──────────────────────────────────

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock('@/lib/whatsapp/send', () => ({
  sendTextMessage: mockSendTextMessage,
}));

vi.mock('@/lib/llm/openrouter', () => ({
  generateResponse: mockGenerateResponse,
  MODELS: { CLASSIFIER: 'test-classifier', STANDARD: 'test-standard' },
}));

vi.mock('@/lib/actions/state-machine', () => ({
  setConversationState: mockSetConversationState,
  getConversationState: mockGetConversationState,
  clearConversationState: mockClearConversationState,
}));

vi.mock('@/lib/marketplace/engine', () => ({
  executeEventAgents: mockExecuteEventAgents,
}));

vi.mock('@/lib/calendar/google', () => ({
  createCalendarEvent: mockCreateCalendarEvent,
  cancelCalendarEvent: mockCancelCalendarEvent,
}));

import { executeAction } from '../engine';

// ── Helpers ────────────────────────────────────────────────

function makeCtx(overrides: Partial<any> = {}): any {
  return {
    tenantId: 'tenant-1',
    phoneNumberId: 'phone-1',
    customerPhone: '+5215512345678',
    customerName: 'Juan Perez',
    contactId: 'contact-1',
    conversationId: 'conv-1',
    intent: 'GREETING',
    content: 'Hola',
    businessType: 'restaurant',
    tenant: { name: 'Mi Negocio', address: 'Calle 1', phone: '5551234567' },
    ...overrides,
  };
}

/**
 * Helper to configure mockFrom for chained Supabase queries.
 * Accepts a map of table names to return values or mock chain overrides.
 */
function setupSupabase(config: Record<string, any> = {}) {
  mockFrom.mockImplementation((table: string) => {
    const tableConfig = config[table] || {};

    // Build a flexible chainable mock
    const chain: any = {};
    const terminalSingle = vi.fn(() => ({
      data: tableConfig.singleData ?? null,
      error: tableConfig.singleError ?? null,
    }));
    const terminalSelect = vi.fn(() => ({
      single: terminalSingle,
      eq: vi.fn(() => ({
        single: terminalSingle,
        eq: vi.fn(() => ({ single: terminalSingle })),
      })),
    }));

    chain.select = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: terminalSingle,
          in: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(() => ({
                single: terminalSingle,
              })),
            })),
          })),
          order: vi.fn(() => tableConfig.selectData ?? []),
          limit: vi.fn(() => ({
            single: terminalSingle,
          })),
        })),
        single: terminalSingle,
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              single: terminalSingle,
            })),
          })),
        })),
      })),
      single: terminalSingle,
    }));

    chain.insert = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => ({
          data: tableConfig.insertData ?? { id: `${table}-new-1` },
          error: tableConfig.insertError ?? null,
        })),
      })),
    }));

    chain.update = vi.fn(() => ({
      eq: vi.fn(() => ({ eq: vi.fn() })),
    }));

    return chain;
  });
}

// ── Tests ──────────────────────────────────────────────────

describe('executeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupSupabase();
  });

  // ── Unknown intent ─────────────────────────────────────

  describe('unknown intent', () => {
    it('returns actionTaken=false for unrecognized intents', async () => {
      const result = await executeAction(makeCtx({ intent: 'UNKNOWN_FOOBAR' }));
      expect(result.actionTaken).toBe(false);
    });

    it('returns actionTaken=false for empty intent', async () => {
      const result = await executeAction(makeCtx({ intent: '' }));
      expect(result.actionTaken).toBe(false);
    });
  });

  // ── HUMAN handoff ──────────────────────────────────────

  describe('HUMAN intent', () => {
    it('marks conversation as human_handoff and returns message', async () => {
      const mockUpdate = vi.fn(() => ({ eq: vi.fn() }));
      mockFrom.mockImplementation((table: string) => {
        if (table === 'conversations') {
          return { update: mockUpdate, select: vi.fn() };
        }
        // audit_log
        return { insert: vi.fn() };
      });

      const result = await executeAction(makeCtx({ intent: 'HUMAN' }));

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('human.handoff');
      expect(result.followUpMessage).toContain('equipo');
      expect(mockUpdate).toHaveBeenCalledWith({ status: 'human_handoff' });
    });
  });

  // ── COMPLAINT ──────────────────────────────────────────

  describe('COMPLAINT intent', () => {
    it('escalates complaint with urgent tags', async () => {
      const convUpdate = vi.fn(() => ({ eq: vi.fn() }));
      const contactUpdate = vi.fn(() => ({ eq: vi.fn() }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'conversations') return { update: convUpdate };
        if (table === 'contacts') return { update: contactUpdate };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(makeCtx({ intent: 'COMPLAINT' }));

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('complaint.escalated');
      expect(result.followUpMessage).toContain('Lamento');
      expect(convUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'human_handoff',
          tags: ['complaint', 'urgent'],
        })
      );
    });
  });

  // ── EMERGENCY ──────────────────────────────────────────

  describe('EMERGENCY intent', () => {
    it('escalates emergency for health businesses with address', async () => {
      const convUpdate = vi.fn(() => ({ eq: vi.fn() }));
      mockFrom.mockImplementation((table: string) => {
        if (table === 'conversations') return { update: convUpdate };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(
        makeCtx({
          intent: 'EMERGENCY',
          businessType: 'dental',
          tenant: { name: 'DentaCare', address: 'Av. Reforma 100', phone: '5551234567' },
        })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('emergency.escalated');
      expect(result.followUpMessage).toContain('DentaCare');
      expect(result.followUpMessage).toContain('Av. Reforma 100');
      expect(result.followUpMessage).toContain('911');
    });

    it('provides generic emergency message for non-health businesses', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'conversations') return { update: vi.fn(() => ({ eq: vi.fn() })) };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(
        makeCtx({ intent: 'EMERGENCY', businessType: 'restaurant' })
      );

      expect(result.followUpMessage).toContain('equipo');
      expect(result.followUpMessage).not.toContain('911');
    });
  });

  // ── CRISIS ─────────────────────────────────────────────

  describe('CRISIS intent', () => {
    it('triggers life-saving protocol with hotline numbers', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'conversations') return { update: vi.fn(() => ({ eq: vi.fn() })) };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(makeCtx({ intent: 'CRISIS' }));

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('crisis.detected');
      expect(result.followUpMessage).toContain('800 911 2000');
      expect(result.followUpMessage).toContain('SAPTEL');
      expect(result.followUpMessage).toContain('911');
    });
  });

  // ── SPAM ───────────────────────────────────────────────

  describe('SPAM intent', () => {
    it('archives conversation and tags contact as spam', async () => {
      const convUpdate = vi.fn(() => ({ eq: vi.fn() }));
      const contactUpdate = vi.fn(() => ({ eq: vi.fn() }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'conversations') return { update: convUpdate };
        if (table === 'contacts') return { update: contactUpdate };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(makeCtx({ intent: 'SPAM' }));

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('spam.archived');
      expect(result.followUpMessage).toBeUndefined();
      expect(convUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'archived', tags: ['spam'] })
      );
    });
  });

  // ── APPOINTMENT_NEW ────────────────────────────────────

  describe('APPOINTMENT_NEW intent', () => {
    it('asks for clarification when date/time is unclear', async () => {
      mockGenerateResponse.mockResolvedValue({
        text: JSON.stringify({ unclear: true, missing: ['date', 'time'] }),
      });

      setupSupabase();

      const result = await executeAction(
        makeCtx({ intent: 'APPOINTMENT_NEW', content: 'Quiero una cita' })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('appointment.clarify');
      expect(result.followUpMessage).toContain('día');
      expect(result.followUpMessage).toContain('hora');
      // (I) Bug fix: state context now persists the partial fields captured
      // so far (even if empty) so the next turn can merge them.
      expect(mockSetConversationState).toHaveBeenCalledWith(
        'conv-1',
        'awaiting_appointment_date',
        expect.any(Object),
      );
    });

    it('creates appointment when date and time are provided', async () => {
      mockGenerateResponse.mockResolvedValue({
        text: JSON.stringify({
          date: '2026-04-10',
          time: '14:00',
          service: 'Corte',
          staff: null,
        }),
      });

      const insertedApt = { id: 'apt-1' };
      mockFrom.mockImplementation((table: string) => {
        if (table === 'staff') {
          // New handler does select().eq().eq() with no .limit()
          const inner = Promise.resolve({
            data: [{ id: 'staff-1', name: 'Dr. Lopez', google_calendar_id: null, default_duration: 30 }],
          });
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => inner),
              })),
            })),
          };
        }
        if (table === 'services') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  data: [{ id: 'svc-1', name: 'Corte de cabello', duration_minutes: 45, price: 200 }],
                })),
              })),
            })),
          };
        }
        if (table === 'appointments') {
          // Chain used by hasConflict(): select().eq().in().lt().gt().eq()
          // Every method returns the same chain object (which is thenable),
          // so `await` at any point resolves to { count: 0 } = no conflict.
          const conflictChain: any = {
            eq: vi.fn(() => conflictChain),
            in: vi.fn(() => conflictChain),
            lt: vi.fn(() => conflictChain),
            gt: vi.fn(() => conflictChain),
            then: (resolve: (v: any) => void) => resolve({ count: 0 }),
          };
          return {
            select: vi.fn(() => conflictChain),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => ({ data: insertedApt, error: null })),
              })),
            })),
            update: vi.fn(() => ({ eq: vi.fn() })),
          };
        }
        if (table === 'contacts') {
          return { update: vi.fn(() => ({ eq: vi.fn() })) };
        }
        if (table === 'audit_log') {
          return { insert: vi.fn() };
        }
        return {};
      });

      const result = await executeAction(
        makeCtx({
          intent: 'APPOINTMENT_NEW',
          content: 'Quiero una cita el 10 de abril a las 2pm para corte',
          tenant: {
            name: 'Mi Negocio',
            address: 'Calle 1',
            phone: '5551234567',
            timezone: 'America/Merida',
            // Business open from 09:00-18:00 every day so 14:00 passes the
            // business-hours gate regardless of which day the test runs on.
            business_hours: {
              lun: '09:00-18:00', mar: '09:00-18:00', mie: '09:00-18:00',
              jue: '09:00-18:00', vie: '09:00-18:00', sab: '09:00-18:00',
              dom: '09:00-18:00',
            },
          },
        })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('appointment.created');
      expect(result.followUpMessage).toContain('Cita agendada');
      expect(result.details?.appointmentId).toBe('apt-1');
    });

    it('surfaces parse failure to the user when LLM returns unparseable JSON', async () => {
      // (F) Bug fix: silent failure was a bug — the old behavior returned
      // actionTaken:false and the user got no explanation. Now we send a
      // clear clarification message so the user knows to retry.
      mockGenerateResponse.mockResolvedValue({ text: 'not json' });
      setupSupabase();

      const result = await executeAction(
        makeCtx({ intent: 'APPOINTMENT_NEW', content: 'cita' })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('appointment.parse_failed');
      expect(result.followUpMessage).toBeTruthy();
    });
  });

  // ── APPOINTMENT_CANCEL ─────────────────────────────────

  describe('APPOINTMENT_CANCEL intent', () => {
    it('cancels existing appointment', async () => {
      const aptUpdate = vi.fn(() => ({ eq: vi.fn() }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'appointments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        single: vi.fn(() => ({
                          data: {
                            id: 'apt-1',
                            datetime: '2026-04-10T14:00:00',
                            google_event_id: null,
                          },
                        })),
                      })),
                    })),
                  })),
                })),
              })),
            })),
            update: aptUpdate,
          };
        }
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(makeCtx({ intent: 'APPOINTMENT_CANCEL' }));

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('appointment.cancelled');
      expect(result.followUpMessage).toContain('cancelada');
      expect(aptUpdate).toHaveBeenCalledWith({ status: 'cancelled' });
    });

    it('returns not-found message when no appointment exists', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'appointments') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  in: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        single: vi.fn(() => ({ data: null })),
                      })),
                    })),
                  })),
                })),
              })),
            })),
          };
        }
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(makeCtx({ intent: 'APPOINTMENT_CANCEL' }));

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('appointment.not_found');
      expect(result.followUpMessage).toContain('No encontré');
    });
  });

  // ── ORDER_NEW ──────────────────────────────────────────

  describe('ORDER_NEW intent', () => {
    it('creates order with items and returns receipt', async () => {
      mockGenerateResponse.mockResolvedValue({
        text: JSON.stringify({
          items: [
            { name: 'Hamburguesa', qty: 2, notes: '' },
            { name: 'Refresco', qty: 1, notes: 'sin hielo' },
          ],
          delivery: true,
          address: 'Calle 5 #100',
        }),
      });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'services') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  data: [
                    { name: 'Hamburguesa clasica', price: 120 },
                    { name: 'Refresco de cola', price: 35 },
                  ],
                })),
              })),
            })),
          };
        }
        if (table === 'orders') {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => ({
                  data: { id: 'order-1' },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(
        makeCtx({
          intent: 'ORDER_NEW',
          content: '2 hamburguesas y un refresco para delivery a Calle 5 #100',
        })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('order.created');
      expect(result.details?.orderId).toBe('order-1');
      expect(result.followUpMessage).toContain('Pedido registrado');
      expect(result.followUpMessage).toContain('Hamburguesa');
    });

    it('asks for clarification when extraction is unclear (was: silently returned actionTaken=false)', async () => {
      // Bug fix: previously, an unclear LLM extraction caused a silent failure
      // where the customer thought they'd ordered but nothing was registered.
      // Now we surface a clarification question so the customer can retry.
      mockGenerateResponse.mockResolvedValue({
        text: JSON.stringify({ unclear: true }),
      });
      setupSupabase();

      const result = await executeAction(
        makeCtx({
          intent: 'ORDER_NEW',
          content: 'quiero pedir algo',
          tenant: {
            name: 'Mi Negocio',
            address: 'Calle 1',
            phone: '5551234567',
            timezone: 'America/Merida',
            business_hours: {
              lun: '09:00-23:00', mar: '09:00-23:00', mie: '09:00-23:00',
              jue: '09:00-23:00', vie: '09:00-23:00', sab: '09:00-23:00',
              dom: '09:00-23:00',
            },
          },
        })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('order.unclear');
      expect(result.followUpMessage).toBeTruthy();
    });
  });

  // ── ORDER_STATUS ───────────────────────────────────────

  describe('ORDER_STATUS intent', () => {
    it('returns status of existing order', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'orders') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      single: vi.fn(() => ({
                        data: {
                          id: 'order-1',
                          status: 'preparing',
                          total: 275,
                          estimated_time_min: 20,
                        },
                      })),
                    })),
                  })),
                })),
              })),
            })),
          };
        }
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(
        makeCtx({ intent: 'ORDER_STATUS', content: 'como va mi pedido?' })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('order.status');
      expect(result.followUpMessage).toContain('preparaci');
      expect(result.followUpMessage).toContain('$275');
    });
  });

  // ── MEDICAL_QUESTION ───────────────────────────────────

  describe('MEDICAL_QUESTION intent', () => {
    it('escalates for health business types', async () => {
      const convUpdate = vi.fn(() => ({ eq: vi.fn() }));
      const contactSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: { tags: [] } })),
        })),
      }));
      const contactUpdate = vi.fn(() => ({ eq: vi.fn() }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'conversations') return { update: convUpdate };
        if (table === 'contacts') return { select: contactSelect, update: contactUpdate };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(
        makeCtx({
          intent: 'MEDICAL_QUESTION',
          businessType: 'dental',
          content: 'Me duele la muela, que debo hacer?',
        })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('medical.escalated');
      expect(result.followUpMessage).toContain('profesional');
    });

    it('returns actionTaken=false for non-health businesses', async () => {
      setupSupabase();

      const result = await executeAction(
        makeCtx({
          intent: 'MEDICAL_QUESTION',
          businessType: 'restaurant',
          content: 'tengo alergia al gluten',
        })
      );

      expect(result.actionTaken).toBe(false);
    });
  });

  // ── LEGAL_QUESTION ─────────────────────────────────────

  describe('LEGAL_QUESTION intent', () => {
    it('escalates legal questions to human handoff', async () => {
      const convUpdate = vi.fn(() => ({ eq: vi.fn() }));
      const contactSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: { tags: [] } })),
        })),
      }));
      const contactUpdate = vi.fn(() => ({ eq: vi.fn() }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'conversations') return { update: convUpdate };
        if (table === 'contacts') return { select: contactSelect, update: contactUpdate };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(
        makeCtx({ intent: 'LEGAL_QUESTION', content: 'necesito asesoria legal' })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('legal.escalated');
      expect(result.followUpMessage).toContain('legales');
    });
  });

  // ── THANKS ─────────────────────────────────────────────

  describe('THANKS intent', () => {
    it('captures positive sentiment and updates contact temperature', async () => {
      const contactSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: { tags: ['new'] } })),
        })),
      }));
      const contactUpdate = vi.fn(() => ({ eq: vi.fn() }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'contacts') return { select: contactSelect, update: contactUpdate };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(
        makeCtx({ intent: 'THANKS', content: 'muchas gracias!' })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('thanks.captured');
      expect(result.followUpMessage).toBeUndefined();
    });
  });

  // ── LOCATION ───────────────────────────────────────────

  describe('LOCATION intent', () => {
    it('returns address when tenant has one', async () => {
      const contactSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: { tags: [] } })),
        })),
      }));
      const contactUpdate = vi.fn(() => ({ eq: vi.fn() }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'contacts') return { select: contactSelect, update: contactUpdate };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(
        makeCtx({
          intent: 'LOCATION',
          tenant: { name: 'TestBiz', address: 'Av. Reforma 222', city: 'CDMX', state: 'CDMX' },
        })
      );

      expect(result.actionTaken).toBe(true);
      expect(result.actionType).toBe('location.sent');
      expect(result.followUpMessage).toContain('Av. Reforma 222');
    });

    it('returns actionTaken=false when tenant has no address', async () => {
      const contactSelect = vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => ({ data: { tags: [] } })),
        })),
      }));
      const contactUpdate = vi.fn(() => ({ eq: vi.fn() }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'contacts') return { select: contactSelect, update: contactUpdate };
        if (table === 'audit_log') return { insert: vi.fn() };
        return {};
      });

      const result = await executeAction(
        makeCtx({ intent: 'LOCATION', tenant: { name: 'TestBiz' } })
      );

      expect(result.actionTaken).toBe(false);
    });
  });

  // ── Error handling ─────────────────────────────────────

  describe('error handling', () => {
    it('catches handler errors and returns actionTaken=false', async () => {
      mockFrom.mockImplementation(() => {
        throw new Error('DB connection failed');
      });

      const result = await executeAction(makeCtx({ intent: 'HUMAN' }));

      expect(result.actionTaken).toBe(false);
    });
  });

  // ── Audit logging ──────────────────────────────────────

  describe('audit logging', () => {
    it('writes audit_log entry when action is taken', async () => {
      const auditInsert = vi.fn();
      const convUpdate = vi.fn(() => ({ eq: vi.fn() }));

      mockFrom.mockImplementation((table: string) => {
        if (table === 'conversations') return { update: convUpdate };
        if (table === 'audit_log') return { insert: auditInsert };
        return {};
      });

      await executeAction(makeCtx({ intent: 'HUMAN' }));

      expect(auditInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'tenant-1',
          action: 'agent.action.human.handoff',
          entity_type: 'conversation',
          entity_id: 'conv-1',
        })
      );
    });

    it('does NOT write audit_log when actionTaken is false', async () => {
      const auditInsert = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'audit_log') return { insert: auditInsert };
        return {};
      });

      await executeAction(makeCtx({ intent: 'UNKNOWN' }));

      expect(auditInsert).not.toHaveBeenCalled();
    });
  });
});
