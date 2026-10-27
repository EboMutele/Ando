import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-report-'));
  process.env.DATA_DIR = dir;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('vet report', () => {
  it('is a single-page PDF even with many checks and an alert', async () => {
    const repo = await import('@/lib/db/repo');
    const { buildVetReport, featureShift } = await import('@/lib/report/pdf');
    const { computeTrend } = await import('@/lib/trend');
    const pet = repo.createPet({ name: 'Luna', species: 'cat', ageMonths: 88 });
    for (let d = 0; d < 14; d++) {
      const id = repo.createCheck({ petId: pet.id, recordedAt: new Date(Date.UTC(2026, 9, d + 1, 9)).toISOString() });
      const s = d > 9 ? 2 : 0;
      repo.saveFeatures(id, (['ears', 'eyes', 'muzzle', 'whiskers', 'head'] as const).map((f) => ({ feature: f, score: s as 0 | 2, inTotal: true, confidence: 'high', evidence: 'x' })));
      repo.updateCheck(id, { status: 'done', stage: 'done', scale: 'FGS', raw_score: s * 5, raw_max: 10, score: s / 2, level: s ? 'elevated' : 'none', confidence: 'high', note: 'A fairly long note about what was observed in the clip, to test wrapping in the report body.' });
    }
    const checks = repo.listChecks(pet.id);
    const trend = computeTrend('cat', checks, 'UTC');
    const alerts = repo.syncAlerts(pet.id, trend.alerts);
    expect(alerts.map((a) => a.kind)).toEqual(['sustained']);

    const pdf = await buildVetReport(pet, checks, trend, alerts);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1').match(/\/Type \/Page\b/g)).toHaveLength(1);

    const shift = featureShift(checks, ['ears']);
    expect(shift[0]).toEqual({ feature: 'ears', before: 0, recent: 2 });
  });
});
