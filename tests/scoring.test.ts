import { describe, expect, it } from 'vitest';
import { aggregate, levelFor, overallConfidence } from '@/lib/scoring/aggregate';
import { sparkAssessmentJsonSchema, sparkAssessmentValidator, type SparkAssessment } from '@/lib/scoring/schema';
import { featuresFor } from '@/lib/scoring/scales';
import { readAssessment } from '@/lib/meta/spark';
import { computeTrend } from '@/lib/trend';

const fa = (score: 0 | 1 | 2 | null, confidence: 'low' | 'medium' | 'high' = 'high') => ({ score, confidence, evidence: 'x', frames: [1] });
const full = { frames: 6, faceFrames: 6, bodyFrames: 6 };

function catAssessment(scores: Partial<Record<string, 0 | 1 | 2 | null>>, extra: Partial<SparkAssessment> = {}): SparkAssessment {
  const features = Object.fromEntries(featuresFor('cat').map((f) => [f, fa(f in scores ? (scores[f] as 0 | 1 | 2 | null) : 0)]));
  return {
    usable: true,
    exclusion: null,
    pet_moving: false,
    features,
    overall_confidence: 'high',
    quality_issues: [],
    note: 'Ears looked a little flatter than usual.',
    ...extra,
  };
}

describe('Feline Grimace Scale total', () => {
  it('sums the five action units out of 10 and ignores supplementary items', () => {
    const r = aggregate('cat', catAssessment({ ears: 2, eyes: 1, muzzle: 1, whiskers: 0, head: 0, posture: 2 }), full)!;
    expect([r.rawScore, r.rawMax, r.score]).toEqual([4, 10, 0.4]);
    expect(r.level).toBe('elevated'); // 4/10 is the published analgesic threshold
  });

  it('drops unscorable units from numerator and denominator', () => {
    const r = aggregate('cat', catAssessment({ ears: 1, eyes: 1, muzzle: 1, whiskers: null, head: null }), full)!;
    expect([r.rawScore, r.rawMax, r.score]).toEqual([3, 6, 0.5]);
    expect(r.confidence).toBe('medium'); // only 3/5 units seen
  });

  it('refuses to score with fewer than three units', () => {
    expect(aggregate('cat', catAssessment({ ears: 2, eyes: 2, muzzle: null, whiskers: null, head: null }), full)).toBeNull();
  });

  it('refuses to score when the model says the clip is unusable', () => {
    expect(aggregate('cat', catAssessment({}, { usable: false, exclusion: 'asleep' }), full)).toBeNull();
  });

  it('only counts gait when the pet moved', () => {
    const dog = (moving: boolean) =>
      aggregate(
        'dog',
        {
          ...catAssessment({}),
          pet_moving: moving,
          features: Object.fromEntries(featuresFor('dog').map((f) => [f, fa(f === 'gait' ? 2 : 0)])),
        },
        full,
      )!;
    expect(dog(false).rawMax).toBe(10);
    expect(dog(false).rawScore).toBe(0);
    expect(dog(true).rawMax).toBe(12);
    expect(dog(true).rawScore).toBe(2);
  });

  it('maps cut-offs per species', () => {
    expect(levelFor('cat', 0.38)).toBe('mild');
    expect(levelFor('cat', 0.39)).toBe('elevated');
    expect(levelFor('cat', 0.1)).toBe('none');
    expect(levelFor('dog', 0.3)).toBe('elevated');
  });
});

describe('confidence', () => {
  it('is capped by what SAM could see', () => {
    expect(overallConfidence({ overall_confidence: 'high' }, 1, full)).toBe('high');
    expect(overallConfidence({ overall_confidence: 'high' }, 1, { frames: 6, faceFrames: 2, bodyFrames: 6 })).toBe('medium');
    expect(overallConfidence({ overall_confidence: 'high' }, 1, { frames: 6, faceFrames: 1, bodyFrames: 6 })).toBe('low');
    expect(overallConfidence({ overall_confidence: 'low' }, 1, full)).toBe('low');
  });
});

describe('Spark output contract', () => {
  it('JSON Schema and validator agree on feature keys', () => {
    for (const species of ['cat', 'dog'] as const) {
      const schema = sparkAssessmentJsonSchema(species) as { properties: { features: { required: string[] } } };
      expect(schema.properties.features.required).toEqual(featuresFor(species));
    }
    expect(featuresFor('dog')).not.toContain('whiskers');
  });

  it('accepts a valid reply, including one wrapped in a code fence', () => {
    const raw = JSON.stringify(catAssessment({ ears: 1 }));
    expect(typeof readAssessment('cat', raw)).toBe('object');
    expect(typeof readAssessment('cat', '```json\n' + raw + '\n```')).toBe('object');
  });

  it('rejects out-of-range scores, missing features and diagnoses', () => {
    const bad = catAssessment({});
    expect(readAssessment('cat', JSON.stringify({ ...bad, features: { ...bad.features, ears: fa(3 as never) } }))).toMatch(/schema/);
    const { ears: _drop, ...rest } = bad.features;
    void _drop;
    expect(readAssessment('cat', JSON.stringify({ ...bad, features: rest }))).toMatch(/schema/);
    expect(readAssessment('cat', JSON.stringify({ ...bad, note: 'This looks like arthritis.' }))).toMatch(/condition/);
    expect(readAssessment('cat', 'not json')).toMatch(/JSON/);
    expect(sparkAssessmentValidator('dog').safeParse(bad).success).toBe(false); // cat keys on a dog
  });
});

describe('trend and alerts', () => {
  const day = (d: number, score: number, confidence: 'low' | 'medium' | 'high' = 'high') => ({
    recordedAt: new Date(Date.UTC(2026, 9, d, 9)).toISOString(),
    score,
    confidence,
  });

  it('no alert for a stable pet', () => {
    const t = computeTrend('cat', [1, 2, 3, 4, 5, 6, 7].map((d) => day(d, 0.1)), 'UTC');
    expect(t.alerts).toEqual([]);
    expect(t.baseline).toBe(0.1);
  });

  it('sustained alert after 3 raised days in the last 5', () => {
    const t = computeTrend('cat', [day(1, 0.1), day(2, 0.1), day(3, 0.2), day(4, 0.1), day(5, 0.1), day(6, 0.5), day(7, 0.1), day(8, 0.4), day(9, 0.5)], 'UTC');
    expect(t.alerts.map((a) => a.kind)).toEqual(['sustained']);
    expect(t.alerts[0].lastDay).toBe('2026-10-09');
  });

  it('no sustained alert if the latest day recovered', () => {
    const t = computeTrend('cat', [day(1, 0.1), day(2, 0.1), day(3, 0.1), day(4, 0.5), day(5, 0.5), day(6, 0.5), day(7, 0.1)], 'UTC');
    expect(t.alerts.some((a) => a.kind === 'sustained')).toBe(false);
  });

  it('uses the pet\'s own baseline, not only the population cut-off', () => {
    // A cat whose relaxed face scores 0.0 rising to 0.3 — below the 0.39 cut-off.
    const t = computeTrend('cat', [day(1, 0), day(2, 0), day(3, 0), day(4, 0), day(5, 0), day(6, 0.3), day(7, 0.3), day(8, 0.3)], 'UTC');
    expect(t.alerts.map((a) => a.kind)).toEqual(['sustained']);
  });

  it('ignores low-confidence checks', () => {
    const t = computeTrend('cat', [day(1, 0.1), day(2, 0.1), day(3, 0.1), day(4, 0.9, 'low'), day(5, 0.9, 'low'), day(6, 0.9, 'low')], 'UTC');
    expect(t.alerts).toEqual([]);
    expect(t.days).toHaveLength(3);
  });

  it('averages several checks on one day', () => {
    const t = computeTrend('dog', [day(1, 0.1), { ...day(1, 0.3), recordedAt: new Date(Date.UTC(2026, 9, 1, 18)).toISOString() }], 'UTC');
    expect(t.days).toEqual([{ day: '2026-10-01', score: 0.2, checks: 2, raised: false }]);
  });

  it('rising notice for a slow upward drift', () => {
    const t = computeTrend('cat', [1, 2, 3, 4, 5, 6, 7, 8].map((d) => day(d, 0.02 + d * 0.025)), 'UTC');
    expect(t.slopePerDay).toBeCloseTo(0.025, 3);
    expect(t.alerts.map((a) => a.kind)).toEqual(['rising']);
  });
});
