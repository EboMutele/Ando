import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config';
import * as repo from './db/repo';
import { mapLimit, MetaConfigError } from './meta/client';
import { choosePet, cropFace, renderOverlay, samConcepts, segmentImage, type Detection } from './meta/sam';
import { scoreWithSpark, type SparkFrame } from './meta/spark';
import { aggregate } from './scoring/aggregate';
import * as storage from './storage';
import { computeTrend } from './trend';
import type { Box, KeyFrame, Pet } from './types';
import { extractKeyFrames } from './video/keyframes';
import { probe, transcode } from './video/ffmpeg';

export const CLIP_MIN_S = 5;
export const CLIP_MAX_S = 15;
const TOLERANCE_S = 0.5;
const SAM_CONCURRENCY = 4;

export class UnusableClipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnusableClipError';
  }
}

/** Validates duration and normalizes the upload. Runs before the request returns, so the owner gets instant feedback. */
export async function ingest(checkId: string, upload: Buffer, ext: string): Promise<{ durationS: number; width: number; height: number }> {
  const originalKey = `checks/${checkId}/original${ext}`;
  await storage.put(originalKey, upload);
  const info = await probe(storage.resolveKey(originalKey));
  if (info.durationS < CLIP_MIN_S - TOLERANCE_S || info.durationS > CLIP_MAX_S + TOLERANCE_S) {
    await storage.remove(`checks/${checkId}`);
    throw new UnusableClipError(`Clips need to be ${CLIP_MIN_S}–${CLIP_MAX_S} seconds long; this one is ${info.durationS.toFixed(1)} s.`);
  }
  const videoKey = `checks/${checkId}/video.mp4`;
  await fs.mkdir(path.dirname(storage.resolveKey(videoKey)), { recursive: true });
  await transcode(storage.resolveKey(originalKey), storage.resolveKey(videoKey));
  await fs.rm(storage.resolveKey(originalKey), { force: true });
  const normalized = await probe(storage.resolveKey(videoKey));
  repo.updateCheck(checkId, {
    video_path: videoKey,
    duration_s: normalized.durationS,
    width: normalized.width,
    height: normalized.height,
  });
  return normalized;
}

interface SegmentedFrame {
  key: KeyFrame;
  frame: Buffer;
  faceCrop: Buffer | null;
  width: number;
  height: number;
}

const centre = (b: Box) => ({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });

/** How far the body travelled across the clip, in body widths. */
export function motionIndex(bodies: (Box | null)[]): number | null {
  const seen = bodies.filter((b): b is Box => b !== null);
  if (seen.length < 2) return null;
  const widths = seen.map((b) => b.right - b.left).sort((a, b) => a - b);
  const width = widths[Math.floor(widths.length / 2)] || 1;
  let travel = 0;
  for (let i = 1; i < seen.length; i++) {
    const a = centre(seen[i - 1]);
    const b = centre(seen[i]);
    travel += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return Math.round((travel / width) * 100) / 100;
}

export async function analyse(checkId: string, pet: Pet, info: { durationS: number }): Promise<void> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), `ando-${checkId}-`));
  try {
    repo.setCheckStage(checkId, 'keyframes');
    const videoFile = storage.resolveKey(`checks/${checkId}/video.mp4`);
    const picked = await extractKeyFrames(videoFile, work, info.durationS);

    repo.setCheckStage(checkId, 'segment');
    const concepts = samConcepts(pet.species);
    const jobs = picked.flatMap((p, i) => [
      { i, phrase: concepts.body },
      { i, phrase: concepts.face },
    ]);
    const frames = await Promise.all(picked.map((p) => fs.readFile(p.file)));
    const results = await mapLimit(jobs, SAM_CONCURRENCY, (job) => segmentImage(frames[job.i], job.phrase));
    const detections = picked.map((_, i) => ({
      bodies: results.filter((_, j) => jobs[j].i === i && jobs[j].phrase === concepts.body).flat() as Detection[],
      faces: results.filter((_, j) => jobs[j].i === i && jobs[j].phrase === concepts.face).flat() as Detection[],
    }));

    const segmented: SegmentedFrame[] = [];
    for (let i = 0; i < picked.length; i++) {
      const { body, face } = choosePet(detections[i].bodies, detections[i].faces);
      const frame = frames[i];
      const meta = await sharp(frame).metadata();
      const base = `checks/${checkId}/frame-${i + 1}`;
      const faceCrop = face ? await cropFace(frame, face.box) : null;
      await storage.put(`${base}.jpg`, frame);
      if (faceCrop) await storage.put(`${base}-face.jpg`, faceCrop);
      if (body || face) await storage.put(`${base}-sam.jpg`, await renderOverlay(frame, body, face));
      segmented.push({
        frame,
        faceCrop,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        key: {
          idx: i + 1,
          tS: Math.round(picked[i].tS * 10) / 10,
          sharpness: picked[i].sharpness,
          framePath: `${base}.jpg`,
          faceCropPath: faceCrop ? `${base}-face.jpg` : null,
          overlayPath: body || face ? `${base}-sam.jpg` : null,
          faceBox: face?.box ?? null,
          bodyBox: body?.box ?? null,
          faceConf: face?.confidence ?? null,
          bodyConf: body?.confidence ?? null,
        },
      });
    }
    repo.saveKeyFrames(checkId, segmented.map((s) => s.key));

    const quality = {
      frames: segmented.length,
      faceFrames: segmented.filter((s) => s.key.faceBox).length,
      bodyFrames: segmented.filter((s) => s.key.bodyBox || s.key.faceBox).length,
    };
    repo.updateCheck(checkId, { sam_json: JSON.stringify(quality) });
    // Quality gate: never score a clip SAM can't find the pet in.
    if (quality.bodyFrames < 2) {
      throw new UnusableClipError(`We couldn't find ${pet.name} clearly in the video. Try again in good light with ${pet.name} filling most of the frame.`);
    }

    repo.setCheckStage(checkId, 'score');
    const sparkFrames: SparkFrame[] = segmented
      .filter((s) => s.key.bodyBox || s.key.faceBox)
      .map((s) => ({
        n: s.key.idx,
        tS: s.key.tS,
        frame: s.frame,
        faceCrop: s.faceCrop,
        faceBox: s.key.faceBox,
        bodyBox: s.key.bodyBox,
        width: s.width,
        height: s.height,
      }));
    const { assessment, model } = await scoreWithSpark({
      species: pet.species,
      petName: pet.name,
      ageMonths: pet.ageMonths,
      frames: sparkFrames,
      motionIndex: motionIndex(segmented.map((s) => s.key.bodyBox)),
    });
    const models = { sam: config.samModel, spark: model };
    const result = aggregate(pet.species, assessment, quality);
    repo.updateCheck(checkId, {
      spark_json: JSON.stringify(assessment),
      models_json: JSON.stringify(models),
      moving: assessment.pet_moving ? 1 : 0,
      note: assessment.note,
    });
    if (!result) {
      const why = assessment.exclusion ? `The scale can't be used when the ${pet.species} is ${assessment.exclusion}.` : 'Too few features were visible to score.';
      throw new UnusableClipError(`${why} ${assessment.quality_issues.join(' ')}`.trim());
    }
    repo.saveFeatures(checkId, result.features);
    repo.updateCheck(checkId, {
      scale: result.scale,
      raw_score: result.rawScore,
      raw_max: result.rawMax,
      score: result.score,
      level: result.level,
      confidence: result.confidence,
      status: 'done',
      stage: 'done',
    });
    refreshAlerts(pet);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

/** Recomputes the trend after a check and opens or closes alerts. */
export function refreshAlerts(pet: Pet) {
  const checks = repo.listChecks(pet.id).filter((c) => c.status === 'done');
  const trend = computeTrend(pet.species, checks);
  return repo.syncAlerts(pet.id, trend.alerts);
}

/** Background part of a check; records the outcome on the check row. */
export async function runAnalysis(checkId: string, pet: Pet, info: { durationS: number }): Promise<void> {
  try {
    await analyse(checkId, pet, info);
  } catch (e) {
    if (e instanceof UnusableClipError) {
      repo.setCheckStage(checkId, 'done', 'unusable', e.message);
    } else if (e instanceof MetaConfigError) {
      repo.setCheckStage(checkId, 'done', 'failed', e.message);
    } else {
      console.error(`[ando] check ${checkId} failed`, e);
      const status = (e as { status?: number }).status;
      const message = status
        ? `The Meta Model API returned ${status}. ${(e as Error).message}`.slice(0, 400)
        : 'Something went wrong while analysing the video. Please try again.';
      repo.setCheckStage(checkId, 'done', 'failed', message);
    }
  }
}

