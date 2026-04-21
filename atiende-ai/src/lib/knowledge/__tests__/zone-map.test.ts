import { describe, it, expect } from 'vitest';
import type { Question } from '@/lib/onboarding/questions';
import { QUESTIONS } from '@/lib/onboarding/questions';
import {
  ZONES,
  ZONE_QUESTION_KEYS,
  SHARED_SCHEDULE_QUESTIONS,
  SHARED_BRAND_QUESTIONS,
  zoneForQuestionKey,
  computeZoneCompletion,
  computeOverallCompletion,
  getVisibleZones,
  getQuestionsForZone,
} from '../zone-map';

describe('zone-map', () => {
  describe('static shape', () => {
    it('defines exactly 10 zones', () => {
      expect(ZONES).toHaveLength(10);
    });

    it('marks schedule and brand as always visible', () => {
      const alwaysVisible = ZONES.filter((z) => z.alwaysVisible).map((z) => z.id);
      expect(alwaysVisible).toEqual(['schedule', 'brand']);
    });

    it('has unique zone ids', () => {
      const ids = ZONES.map((z) => z.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('has an entry in ZONE_QUESTION_KEYS for every zone', () => {
      for (const zone of ZONES) {
        expect(ZONE_QUESTION_KEYS).toHaveProperty(zone.id);
      }
    });

    it('shared schedule questions expose the expected keys', () => {
      const keys = SHARED_SCHEDULE_QUESTIONS.map((q) => q.key);
      expect(keys).toContain('hours_weekday');
      expect(keys).toContain('hours_saturday');
      expect(keys).toContain('holidays');
    });

    it('shared brand questions expose the expected keys', () => {
      const keys = SHARED_BRAND_QUESTIONS.map((q) => q.key);
      expect(keys).toContain('tone');
      expect(keys).toContain('differentiator');
    });
  });

  describe('zoneForQuestionKey', () => {
    it('maps well-known keys to their zone', () => {
      expect(zoneForQuestionKey('services_prices')).toBe('services');
      expect(zoneForQuestionKey('doctors')).toBe('team');
      expect(zoneForQuestionKey('parking')).toBe('location');
      expect(zoneForQuestionKey('payment_methods')).toBe('payments');
      expect(zoneForQuestionKey('cancellation')).toBe('policies');
      expect(zoneForQuestionKey('insurances')).toBe('special');
      expect(zoneForQuestionKey('first_visit')).toBe('experience');
      expect(zoneForQuestionKey('tone')).toBe('brand');
      expect(zoneForQuestionKey('delivery')).toBe('logistics');
      expect(zoneForQuestionKey('hours_weekday')).toBe('schedule');
    });

    it('falls back to brand for unknown keys', () => {
      expect(zoneForQuestionKey('made_up_key_xyz')).toBe('brand');
    });
  });

  describe('computeZoneCompletion', () => {
    const dentalQs = QUESTIONS.dental as Question[];

    it('reports 0% when nothing is answered', () => {
      const comp = computeZoneCompletion('services', dentalQs, new Set());
      expect(comp.answered).toBe(0);
      expect(comp.percent).toBe(0);
      expect(comp.total).toBeGreaterThan(0);
    });

    it('reports 100% when every relevant key is answered', () => {
      const allKeys = new Set(dentalQs.map((q) => q.key));
      const comp = computeZoneCompletion('team', dentalQs, allKeys);
      expect(comp.percent).toBe(100);
      expect(comp.answered).toBe(comp.total);
    });

    it('rounds partial completion', () => {
      // psychologist has services_prices + therapy_types in services zone.
      const psychQs = QUESTIONS.psychologist as Question[];
      const halfAnswered = new Set(['services_prices']);
      const comp = computeZoneCompletion('services', psychQs, halfAnswered);
      expect(comp.total).toBeGreaterThanOrEqual(2);
      expect(comp.percent).toBeGreaterThan(0);
      expect(comp.percent).toBeLessThan(100);
    });

    it('includes shared schedule questions for the schedule zone', () => {
      const comp = computeZoneCompletion(
        'schedule',
        dentalQs,
        new Set(['hours_weekday', 'hours_saturday']),
      );
      expect(comp.total).toBe(SHARED_SCHEDULE_QUESTIONS.length);
      expect(comp.answered).toBe(2);
    });

    it('merges shared + vertical brand keys for the brand zone', () => {
      // dental has no vertical brand key, so brand is purely shared.
      const comp = computeZoneCompletion('brand', dentalQs, new Set(['tone']));
      expect(comp.total).toBe(SHARED_BRAND_QUESTIONS.length);
      expect(comp.answered).toBe(1);
    });
  });

  describe('computeOverallCompletion', () => {
    const dentalQs = QUESTIONS.dental as Question[];

    it('sums totals across zones', () => {
      const overall = computeOverallCompletion(dentalQs, new Set());
      expect(overall.total).toBeGreaterThan(0);
      expect(overall.answered).toBe(0);
      expect(overall.percent).toBe(0);
    });

    it('reports 100 when every tracked key is answered', () => {
      const overallKeys = new Set<string>();
      for (const q of dentalQs) overallKeys.add(q.key);
      for (const q of SHARED_SCHEDULE_QUESTIONS) overallKeys.add(q.key);
      for (const q of SHARED_BRAND_QUESTIONS) overallKeys.add(q.key);
      const overall = computeOverallCompletion(dentalQs, overallKeys);
      expect(overall.percent).toBe(100);
    });
  });

  describe('getVisibleZones', () => {
    it('keeps schedule and brand even when empty', () => {
      const empty: Question[] = [];
      const visible = getVisibleZones(empty).map((z) => z.id);
      expect(visible).toContain('schedule');
      expect(visible).toContain('brand');
    });

    it('hides zones with zero vertical keys', () => {
      const empty: Question[] = [];
      const visible = getVisibleZones(empty).map((z) => z.id);
      expect(visible).not.toContain('services');
      expect(visible).not.toContain('team');
    });

    it('shows zones with at least one matching vertical key', () => {
      const dentalQs = QUESTIONS.dental as Question[];
      const visible = getVisibleZones(dentalQs).map((z) => z.id);
      expect(visible).toContain('services');
      expect(visible).toContain('team');
      expect(visible).toContain('policies');
    });
  });

  describe('getQuestionsForZone', () => {
    it('returns shared schedule questions for schedule zone', () => {
      const dentalQs = QUESTIONS.dental as Question[];
      const qs = getQuestionsForZone('schedule', dentalQs);
      expect(qs).toEqual(SHARED_SCHEDULE_QUESTIONS);
    });

    it('filters vertical questions to zone keys', () => {
      const dentalQs = QUESTIONS.dental as Question[];
      const qs = getQuestionsForZone('team', dentalQs);
      expect(qs.every((q) => ZONE_QUESTION_KEYS.team.includes(q.key))).toBe(true);
      expect(qs.some((q) => q.key === 'doctors')).toBe(true);
    });

    it('merges shared and vertical keys for brand', () => {
      const restaurantQs = QUESTIONS.restaurant as Question[];
      const qs = getQuestionsForZone('brand', restaurantQs);
      expect(qs.slice(0, SHARED_BRAND_QUESTIONS.length)).toEqual(SHARED_BRAND_QUESTIONS);
    });
  });
});
