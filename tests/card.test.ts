import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockMeta } from '../scripts/mock-meta';

let mock: Awaited<ReturnType<typeof startMockMeta>>;
let dir: string;
beforeAll(async () => {
  mock = await startMockMeta(0);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-card-'));
  Object.assign(process.env, { DATA_DIR: dir, META_BASE_URL: mock.url, MODEL_API_KEY: 'k', MUSE_IMAGE_ENABLED: 'true' });
});
afterAll(async () => {
  await mock.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('summary card', () => {
  it('uses Muse Image for the illustration only, and caches it', async () => {
    const repo = await import('@/lib/db/repo');
    const storage = await import('@/lib/storage');
    const { renderCard } = await import('@/lib/report/card');
    const { cardPrompt } = await import('@/lib/meta/museImage');
    const pet = repo.createPet({ name: 'Luna', species: 'cat', ageMonths: 88 });
    pet.photoPath = await storage.put(`pets/${pet.id}/photo.jpg`, await sharp({ create: { width: 100, height: 100, channels: 3, background: '#a66' } }).jpeg().toBuffer());
    const trend = { days: [{ day: '2026-10-01', score: 0.1, checks: 1, raised: false }, { day: '2026-10-02', score: 0.5, checks: 1, raised: true }], baseline: null, threshold: 0.39, slopePerDay: null, alerts: [] };

    const png = await renderCard(pet, trend, null);
    expect(await sharp(png).metadata()).toMatchObject({ width: 1080, height: 1350, format: 'png' });
    await renderCard(pet, trend, null);
    const calls = mock.requests.filter((r) => r.path.includes('/images/'));
    expect(calls.map((c) => c.path)).toEqual(['/v1/images/edits']); // photo → edits; second render hits the cache
    expect(cardPrompt(pet, 'elevated')).toMatch(/no text/);
    expect(cardPrompt(pet, 'elevated')).not.toMatch(/pain|injur|sick/i);
  });
});
