import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { sampleFrames } from './ffmpeg';

export const SAMPLE_FPS = 2;
export const KEY_FRAME_COUNT = 6;

export interface FrameCandidate {
  file: string;
  tS: number;
  sharpness: number;
}

/**
 * Variance of the Laplacian on a downscaled greyscale copy: the standard
 * cheap focus measure. Motion-blurred frames score low, which matters for
 * reading subtle cues like whisker position or orbital tightening.
 */
export async function sharpness(image: Buffer | string): Promise<number> {
  const { data, info } = await sharp(image)
    .greyscale()
    .resize({ width: 320, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = data[i - w] + data[i + w] + data[i - 1] + data[i + 1] - 4 * data[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.round(sumSq / n - mean * mean);
}

/**
 * Splits the clip into `count` equal segments and keeps the sharpest sampled
 * frame from each, so the key frames are both in focus and spread over the
 * whole clip (needed to judge posture changes and gait).
 */
export function pickKeyFrames(candidates: FrameCandidate[], durationS: number, count = KEY_FRAME_COUNT): FrameCandidate[] {
  if (candidates.length <= count) return candidates;
  const picked: FrameCandidate[] = [];
  const seg = durationS / count;
  for (let i = 0; i < count; i++) {
    const inSeg = candidates.filter((c) => c.tS >= i * seg && (c.tS < (i + 1) * seg || i === count - 1));
    if (inSeg.length === 0) continue;
    picked.push(inSeg.reduce((best, c) => (c.sharpness > best.sharpness ? c : best)));
  }
  return picked;
}

export async function extractKeyFrames(video: string, workDir: string, durationS: number): Promise<FrameCandidate[]> {
  await fs.mkdir(workDir, { recursive: true });
  await sampleFrames(video, workDir, SAMPLE_FPS);
  const files = (await fs.readdir(workDir)).filter((f) => f.endsWith('.jpg')).sort();
  const candidates = await Promise.all(
    files.map(async (f, i) => {
      const file = path.join(workDir, f);
      // ffmpeg's fps filter emits frame i at roughly (i + 0.5) / fps.
      return { file, tS: Math.min(durationS, (i + 0.5) / SAMPLE_FPS), sharpness: await sharpness(file) };
    }),
  );
  return pickKeyFrames(candidates, durationS);
}
