/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Supabase ───────────────────────────────────────────
// AUDIT R15: state-machine ahora usa `metadata` JSONB (no `tags[]`).

const { mockSingle, mockSelect, mockRpc } = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: mockSingle })) }));
  const mockRpc = vi.fn(() => Promise.resolve({ error: null }));
  return { mockSingle, mockSelect, mockRpc };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'conversations') {
        return {
          select: mockSelect,
        };
      }
      return {};
    }),
    rpc: mockRpc,
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
  });

  it('calls the set_conversation_state RPC with state and default context', async () => {
    await setConversationState('conv-1', 'awaiting_appointment_date');

    expect(mockRpc).toHaveBeenCalledWith('set_conversation_state', {
      p_conversation_id: 'conv-1',
      p_state: 'awaiting_appointment_date',
      p_context: {},
    });
  });

  it('passes context when provided', async () => {
    await setConversationState('conv-1', 'awaiting_modify_date', { appointmentId: 'apt-1' });

    expect(mockRpc).toHaveBeenCalledWith('set_conversation_state', {
      p_conversation_id: 'conv-1',
      p_state: 'awaiting_modify_date',
      p_context: { appointmentId: 'apt-1' },
    });
  });

  it('passes null state to the RPC when clearing', async () => {
    await setConversationState('conv-1', null);

    expect(mockRpc).toHaveBeenCalledWith('set_conversation_state', {
      p_conversation_id: 'conv-1',
      p_state: null,
      p_context: {},
    });
  });
});

describe('clearConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to setConversationState with null state via RPC', async () => {
    await clearConversationState('conv-1');

    expect(mockRpc).toHaveBeenCalledWith('set_conversation_state', {
      p_conversation_id: 'conv-1',
      p_state: null,
      p_context: {},
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
