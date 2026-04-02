/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Supabase ───────────────────────────────────────────

const mockSingle = vi.fn();
const mockEq = vi.fn(() => ({ single: mockSingle }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockUpdate = vi.fn(() => ({ eq: vi.fn() }));

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

  it('returns null state when no state tag exists', async () => {
    mockSingle.mockResolvedValue({ data: { tags: ['vip', 'new'] } });

    const result = await getConversationState('conv-1');
    expect(result.state).toBeNull();
    expect(result.context).toEqual({});
  });

  it('returns the current state from tags', async () => {
    mockSingle.mockResolvedValue({
      data: { tags: ['state:awaiting_appointment_date', 'other'] },
    });

    const result = await getConversationState('conv-1');
    expect(result.state).toBe('awaiting_appointment_date');
  });

  it('returns context when ctx: tag exists', async () => {
    const ctx = JSON.stringify({ service: 'corte', date: '2026-04-03' });
    mockSingle.mockResolvedValue({
      data: { tags: [`state:awaiting_order_confirmation`, `ctx:${ctx}`] },
    });

    const result = await getConversationState('conv-1');
    expect(result.state).toBe('awaiting_order_confirmation');
    expect(result.context).toEqual({ service: 'corte', date: '2026-04-03' });
  });

  it('returns null state and empty context when tags are empty', async () => {
    mockSingle.mockResolvedValue({ data: { tags: [] } });

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
    mockSingle.mockResolvedValue({ data: { tags: [] } });

    await getConversationState('conv-xyz');
    expect(mockSelect).toHaveBeenCalledWith('tags');
    expect(mockEq).toHaveBeenCalledWith('id', 'conv-xyz');
  });
});

describe('setConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // For the internal select call that reads existing tags
    mockSingle.mockResolvedValue({ data: { tags: ['vip', 'state:old_state'] } });
  });

  it('sets a new state tag, removing old state tags', async () => {
    await setConversationState('conv-1', 'awaiting_appointment_date');

    expect(mockUpdate).toHaveBeenCalledWith({
      tags: ['vip', 'state:awaiting_appointment_date'],
    });
  });

  it('includes context tag when context is provided', async () => {
    mockSingle.mockResolvedValue({ data: { tags: [] } });

    await setConversationState('conv-1', 'awaiting_modify_date', {
      appointmentId: 'apt-1',
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      tags: [
        'state:awaiting_modify_date',
        `ctx:${JSON.stringify({ appointmentId: 'apt-1' })}`,
      ],
    });
  });

  it('clears state and context tags when state is null', async () => {
    mockSingle.mockResolvedValue({
      data: { tags: ['vip', 'state:awaiting_appointment_date', 'ctx:{"a":1}'] },
    });

    await setConversationState('conv-1', null);

    expect(mockUpdate).toHaveBeenCalledWith({ tags: ['vip'] });
  });

  it('preserves non-state/ctx tags', async () => {
    mockSingle.mockResolvedValue({
      data: { tags: ['complaint', 'urgent', 'state:old', 'ctx:{}'] },
    });

    await setConversationState('conv-1', 'awaiting_reservation_details');

    expect(mockUpdate).toHaveBeenCalledWith({
      tags: ['complaint', 'urgent', 'state:awaiting_reservation_details'],
    });
  });
});

describe('clearConversationState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockResolvedValue({
      data: { tags: ['vip', 'state:awaiting_appointment_date', 'ctx:{"x":1}'] },
    });
  });

  it('removes all state and context tags', async () => {
    await clearConversationState('conv-1');

    expect(mockUpdate).toHaveBeenCalledWith({ tags: ['vip'] });
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
