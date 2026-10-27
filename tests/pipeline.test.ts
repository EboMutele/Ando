import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockMeta, type RecordedRequest } from '../scripts/mock-meta';

// End-to-end through the real OpenAI SDK against a local stand-in for the
// Meta Model API: verifies what Ando actually puts on the wire.
let mock: Awaited<ReturnType<typeof startMockMeta>>;
let dir: string;

function makeClip(file: string, seconds: number) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${seconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
}

beforeAll(async () => {
  mock = await startMockMeta(0);
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ando-test-'));
  process.env.META_BASE_URL = mock.url;
  process.env.MODEL_API_KEY = 'test-key';
  process.env.DATA_DIR = dir;
});

afterAll(async () => {
  await mock.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('check pipeline', () => {
  it('ingests, segments with SAM and scores with Spark', async () => {
    const repo = await import('@/lib/db/repo');
    const { ingest, runAnalysis } = await import('@/lib/pipeline');
    const pet = repo.createPet({ name: 'Miso', species: 'cat', ageMonths: 30 });
    const id = repo.createCheck({ petId: pet.id });
    const clip = path.join(dir, 'clip.mp4');
    makeClip(clip, 7);

    const info = await ingest(id, fs.readFileSync(clip), '.mp4');
    expect(info.durationS).toBeGreaterThan(6.5);
    await runAnalysis(id, pet, info);

    const check = repo.getCheck(id)!;
    expect(check.error).toBeNull();
    expect(check.status).toBe('done');
    expect(check.scale).toBe('FGS');
    expect(check.keyFrames).toHaveLength(6);
    expect(check.keyFrames.every((k) => k.faceBox && k.bodyBox && k.faceCropPath && k.overlayPath)).toBe(true);
    expect(check.features.map((f) => f.feature)).toEqual(['ears', 'eyes', 'muzzle', 'whiskers', 'head', 'posture', 'gait']);
    expect(check.rawMax).toBe(10);
    expect(check.score).toBeCloseTo(check.rawScore! / 10, 3);
    expect(check.models).toEqual({ sam: 'sam-3.1', spark: 'muse-spark-1.3' });

    const sam = mock.requests.filter((r: RecordedRequest) => r.path.endsWith('/responses'));
    expect(sam).toHaveLength(12); // 6 frames × (body, face)
    expect(new Set(sam.map((r) => (r.body.input as { content: { text?: string }[] }[])[0].content[0].text))).toEqual(new Set(['cat', 'cat face']));
    expect(sam[0].body).toMatchObject({ model: 'sam-3.1', stream: false, metadata: { include_confidence: 'true' } });

    const spark = mock.requests.filter((r) => r.path.endsWith('/chat/completions'));
    expect(spark).toHaveLength(1);
    const body = spark[0].body as { model: string; response_format: { type: string; json_schema: { strict: boolean } }; messages: { content: unknown }[] };
    expect(body.model).toBe('muse-spark-1.3');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
    const parts = body.messages[1].content as { type: string }[];
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(12); // frame + face crop each
  });

  it('rejects clips outside 5–15 s before calling any model', async () => {
    const repo = await import('@/lib/db/repo');
    const { ingest, UnusableClipError } = await import('@/lib/pipeline');
    const pet = repo.createPet({ name: 'Rex', species: 'dog', ageMonths: 50 });
    const id = repo.createCheck({ petId: pet.id });
    const clip = path.join(dir, 'short.mp4');
    makeClip(clip, 2);
    const before = mock.requests.length;
    await expect(ingest(id, fs.readFileSync(clip), '.mp4')).rejects.toBeInstanceOf(UnusableClipError);
    expect(mock.requests.length).toBe(before);
  });
});
