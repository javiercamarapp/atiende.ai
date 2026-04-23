import { describe, it, expect } from 'vitest';
import type { Question } from '@/lib/onboarding/questions';
import { QUESTIONS } from '@/lib/onboarding/questions';
import {
  ZONES,
  computeZoneCompletion,
  computeOverallCompletion,
  getVisibleZones,
  getQuestionsForZone,
  SHARED_SCHEDULE_QUESTIONS,
  SHARED_SERVICES_QUESTIONS,
  SHARED_TEAM_QUESTIONS,
  SHARED_LOCATION_QUESTIONS,
  SHARED_PAYMENTS_QUESTIONS,
  SHARED_POLICIES_QUESTIONS,
  SHARED_SPECIAL_QUESTIONS,
  SHARED_EXPERIENCE_QUESTIONS,
  SHARED_BRAND_QUESTIONS,
} from '@/lib/knowledge/zone-map';

const dentalQs = QUESTIONS.dental as Question[];

const ALL_SHARED = [
  SHARED_SCHEDULE_QUESTIONS,
  SHARED_SERVICES_QUESTIONS,
  SHARED_TEAM_QUESTIONS,
  SHARED_LOCATION_QUESTIONS,
  SHARED_PAYMENTS_QUESTIONS,
  SHARED_POLICIES_QUESTIONS,
  SHARED_SPECIAL_QUESTIONS,
  SHARED_EXPERIENCE_QUESTIONS,
  SHARED_BRAND_QUESTIONS,
];

describe('zone-map', () => {
  describe('ZONES', () => {
    it('has unique zone IDs', () => {
      const ids = ZONES.map((z) => z.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('includes doc zones', () => {
      const ids = ZONES.map((z) => z.id);
      expect(ids).toContain('docs-menu');
      expect(ids).toContain('docs-general');
    });
  });

  describe('shared questions', () => {
    it('has max ~50 total shared questions', () => {
      const total = ALL_SHARED.reduce((s, arr) => s + arr.length, 0);
      expect(total).toBeLessThanOrEqual(55);
      expect(total).toBeGreaterThan(30);
    });

    it('each question has a unique key', () => {
      const allKeys = ALL_SHARED.flatMap((arr) => arr.map((q) => q.key));
      expect(new Set(allKeys).size).toBe(allKeys.length);
    });
  });

  describe('computeZoneCompletion', () => {
    it('reports 0% with no answers', () => {
      const comp = computeZoneCompletion('schedule', dentalQs, new Set());
      expect(comp.answered).toBe(0);
      expect(comp.percent).toBe(0);
      expect(comp.total).toBeGreaterThan(0);
    });

    it('reports 100% when every relevant key is answered', () => {
      const allKeys = new Set([
        ...dentalQs.map((q) => q.key),
        ...SHARED_TEAM_QUESTIONS.map((q) => q.key),
      ]);
      const comp = computeZoneCompletion('team', dentalQs, allKeys);
      expect(comp.percent).toBe(100);
      expect(comp.answered).toBe(comp.total);
    });

    it('counts schedule shared questions', () => {
      const comp = computeZoneCompletion('schedule', dentalQs, new Set());
      expect(comp.total).toBe(SHARED_SCHEDULE_QUESTIONS.length);
    });

    it('counts brand shared questions plus vertical keys', () => {
      const comp = computeZoneCompletion('brand', dentalQs, new Set());
      expect(comp.total).toBeGreaterThanOrEqual(SHARED_BRAND_QUESTIONS.length);
    });
  });

  describe('computeOverallCompletion', () => {
    it('reports 100 when every tracked key is answered', () => {
      const overallKeys = new Set<string>();
      for (const q of dentalQs) overallKeys.add(q.key);
      for (const arr of ALL_SHARED) {
        for (const q of arr) overallKeys.add(q.key);
      }
      const overall = computeOverallCompletion(dentalQs, overallKeys);
      expect(overall.percent).toBe(100);
    });
  });

  describe('getVisibleZones', () => {
    it('keeps always-visible zones even when empty', () => {
      const empty: Question[] = [];
      const visible = getVisibleZones(empty).map((z) => z.id);
      expect(visible).toContain('schedule');
      expect(visible).toContain('brand');
      expect(visible).toContain('docs-menu');
      expect(visible).toContain('docs-general');
    });

    it('shows zones with at least one matching vertical key', () => {
      const visible = getVisibleZones(dentalQs).map((z) => z.id);
      expect(visible).toContain('services');
      expect(visible).toContain('team');
    });
  });

  describe('getQuestionsForZone', () => {
    it('returns shared schedule questions for schedule zone', () => {
      const qs = getQuestionsForZone('schedule', dentalQs);
      expect(qs.length).toBeGreaterThanOrEqual(SHARED_SCHEDULE_QUESTIONS.length);
    });

    it('returns empty for doc zones', () => {
      const qs = getQuestionsForZone('docs-menu', dentalQs);
      expect(qs.length).toBe(0);
    });

    it('includes shared + vertical for brand zone', () => {
      const qs = getQuestionsForZone('brand', dentalQs);
      expect(qs.length).toBeGreaterThanOrEqual(SHARED_BRAND_QUESTIONS.length);
      expect(qs.slice(0, SHARED_BRAND_QUESTIONS.length)).toEqual(SHARED_BRAND_QUESTIONS);
    });
  });
});
