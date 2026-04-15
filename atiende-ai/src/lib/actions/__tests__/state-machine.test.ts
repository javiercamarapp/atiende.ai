/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Supabase ───────────────────────────────────────────
// AUDIT R15: state-machine ahora usa `metadata` JSONB (no `tags[]`).

const mockSingle = vi.fn();
const mockUpdateEq = vi.fn(() => Promise.resolve({ error: null }));
const mockSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: mockSingle })) }));
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

  it('returns null state when metadata is empty', async () => {
    mockSingle.mockResolvedValue({ data: { metadata: {} } });

    const result = await getConversationState('conv-1');
    expect(result.state).toBeNull();
    expect(result.context).toEqual({});
  });

  it('returns the current state from metadata.conversation_state', async () => {
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

  it('returns context when metadata.conversation_state.context exists', async () => {
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

  it('returns null state and empty context when metadata is null', async () => {
    mockSingle.mockResolvedValue({ data: { metadata: null } });

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

  it('queries the metadata column by conversation id', async () => {
    mockSingle.mockResolvedValue({ data: { metadata: {} } });

    await getConversationState('conv-xyz');
    expect(mockSelect).toHaveBeenCalledWith('metadata');
  });
});

describe('setConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({ data: { metadata: { other_key: 'preserved' } } });
  });

  it('writes conversation_state into metadata merging existing keys', async () => {
    await setConversationState('conv-1', 'awaiting_appointment_date');

    expect(mockUpdate).toHaveBeenCalledWith({
      metadata: {
        other_key: 'preserved',
        conversation_state: {
          state: 'awaiting_appointment_date',
          context: {},
        },
      },
    });
  });

  it('includes context when provided', async () => {
    mockSingle.mockResolvedValue({ data: { metadata: {} } });

    await setConversationState('conv-1', 'awaiting_modify_date', { appointmentId: 'apt-1' });

    expect(mockUpdate).toHaveBeenCalledWith({
      metadata: {
        conversation_state: {
          state: 'awaiting_modify_date',
          context: { appointmentId: 'apt-1' },
        },
      },
    });
  });

  it('deletes conversation_state from metadata when state is null', async () => {
    mockSingle.mockResolvedValue({
      data: {
        metadata: {
          other_key: 'preserved',
          conversation_state: { state: 'awaiting_appointment_date', context: { a: 1 } },
        },
      },
    });

    await setConversationState('conv-1', null);

    expect(mockUpdate).toHaveBeenCalledWith({
      metadata: { other_key: 'preserved' },
    });
  });

  it('preserves other metadata keys when setting state', async () => {
    mockSingle.mockResolvedValue({
      data: { metadata: { vip: true, source: 'referral' } },
    });

    await setConversationState('conv-1', 'awaiting_reservation_details');

    expect(mockUpdate).toHaveBeenCalledWith({
      metadata: {
        vip: true,
        source: 'referral',
        conversation_state: {
          state: 'awaiting_reservation_details',
          context: {},
        },
      },
    });
  });
});

describe('clearConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({
      data: {
        metadata: {
          vip: true,
          conversation_state: { state: 'awaiting_appointment_date', context: { x: 1 } },
        },
      },
    });
  });

  it('removes conversation_state from metadata, preserves other keys', async () => {
    await clearConversationState('conv-1');

    expect(mockUpdate).toHaveBeenCalledWith({ metadata: { vip: true } });
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
