/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Supabase ───────────────────────────────────────────
//
// state-machine.ts uses the chained query:
//   supabaseAdmin.from('conversations').select('metadata').eq('id', id).single()
//   supabaseAdmin.from('conversations').update({ metadata }).eq('id', id)
//
// We provide a fresh chain object per from() call so that each call records
// its own select/eq/single/update invocations against shared spies.

const mockSingle = vi.fn();
const mockSelectEq = vi.fn(() => ({ single: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockSelectEq }));
const mockUpdateEq = vi.fn(() => Promise.resolve({ data: null, error: null }));
const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'conversations') {
        return {
          select: mockSelect,
          update: mockUpdate,
        };
      }
      return {};
    }),
  },
}));

import {
  getConversationState,
  setConversationState,
  clearConversationState,
  type ConversationState,
} from '../state-machine';

// ── Tests ───────────────────────────────────────────────────

describe('getConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null state when metadata has no conversation_state', async () => {
    mockSingle.mockResolvedValue({ data: { metadata: { other_key: 'x' } } });

    const result = await getConversationState('conv-1');
    expect(result.state).toBeNull();
    expect(result.context).toEqual({});
  });

  it('returns the current state from metadata', async () => {
    mockSingle.mockResolvedValue({
      data: {
        metadata: {
          conversation_state: { state: 'awaiting_appointment_date', context: {} },
        },
      },
    });

    const result = await getConversationState('conv-1');
    expect(result.state).toBe('awaiting_appointment_date');
  });

  it('returns context when conversation_state has context', async () => {
    mockSingle.mockResolvedValue({
      data: {
        metadata: {
          conversation_state: {
            state: 'awaiting_order_confirmation',
            context: { service: 'corte', date: '2026-04-03' },
          },
        },
      },
    });

    const result = await getConversationState('conv-1');
    expect(result.state).toBe('awaiting_order_confirmation');
    expect(result.context).toEqual({ service: 'corte', date: '2026-04-03' });
  });

  it('returns null state and empty context when metadata is empty', async () => {
    mockSingle.mockResolvedValue({ data: { metadata: {} } });

    const result = await getConversationState('conv-1');
    expect(result.state).toBeNull();
    expect(result.context).toEqual({});
  });

  it('returns null state and empty context when data is null', async () => {
    mockSingle.mockResolvedValue({ data: null });

    const result = await getConversationState('conv-1');
    expect(result.state).toBeNull();
    expect(result.context).toEqual({});
  });

  it('queries the correct conversation by id', async () => {
    mockSingle.mockResolvedValue({ data: { metadata: {} } });

    await getConversationState('conv-xyz');
    expect(mockSelect).toHaveBeenCalledWith('metadata');
    expect(mockSelectEq).toHaveBeenCalledWith('id', 'conv-xyz');
  });
});

describe('setConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: pre-existing metadata to merge with
    mockSingle.mockResolvedValue({
      data: { metadata: { unrelated_key: 'preserved' } },
    });
  });

  it('writes a new conversation_state into metadata', async () => {
    await setConversationState('conv-1', 'awaiting_appointment_date');

    expect(mockUpdate).toHaveBeenCalledWith({
      metadata: {
        unrelated_key: 'preserved',
        conversation_state: {
          state: 'awaiting_appointment_date',
          context: {},
        },
      },
    });
  });

  it('includes context when provided', async () => {
    mockSingle.mockResolvedValue({ data: { metadata: {} } });

    await setConversationState('conv-1', 'awaiting_modify_date', {
      appointmentId: 'apt-1',
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      metadata: {
        conversation_state: {
          state: 'awaiting_modify_date',
          context: { appointmentId: 'apt-1' },
        },
      },
    });
  });

  it('removes conversation_state from metadata when state is null', async () => {
    mockSingle.mockResolvedValue({
      data: {
        metadata: {
          unrelated_key: 'preserved',
          conversation_state: {
            state: 'awaiting_appointment_date',
            context: {},
          },
        },
      },
    });

    await setConversationState('conv-1', null);

    expect(mockUpdate).toHaveBeenCalledWith({
      metadata: { unrelated_key: 'preserved' },
    });
  });

  it('preserves other metadata keys when updating state', async () => {
    mockSingle.mockResolvedValue({
      data: {
        metadata: {
          tags: ['vip'],
          journey_stage: 'consideration',
          conversation_state: { state: 'old', context: {} },
        },
      },
    });

    await setConversationState('conv-1', 'awaiting_reservation_details');

    expect(mockUpdate).toHaveBeenCalledWith({
      metadata: {
        tags: ['vip'],
        journey_stage: 'consideration',
        conversation_state: {
          state: 'awaiting_reservation_details',
          context: {},
        },
      },
    });
  });

  it('targets the correct conversation when updating', async () => {
    await setConversationState('conv-xyz', 'awaiting_appointment_date');
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'conv-xyz');
  });
});

describe('clearConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({
      data: {
        metadata: {
          unrelated: 'kept',
          conversation_state: {
            state: 'awaiting_appointment_date',
            context: { x: 1 },
          },
        },
      },
    });
  });

  it('removes conversation_state but keeps other metadata keys', async () => {
    await clearConversationState('conv-1');

    expect(mockUpdate).toHaveBeenCalledWith({
      metadata: { unrelated: 'kept' },
    });
  });
});

// ── Type safety tests ───────────────────────────────────────

describe('ConversationState type', () => {
  it('accepts all valid states', () => {
    const states: ConversationState[] = [
      'awaiting_appointment_date',
      'awaiting_modify_date',
      'awaiting_order_confirmation',
      'awaiting_reservation_details',
      null,
    ];
    expect(states).toHaveLength(5);
  });
});
