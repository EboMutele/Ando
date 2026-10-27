import { nanoid } from 'nanoid';
import { db } from './index';
import type {
  Alert,
  Box,
  Check,
  CheckStage,
  CheckStatus,
  FeatureResult,
  KeyFrame,
  Pet,
  Species,
} from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any -- rows come back untyped from SQLite */

const FEATURE_ORDER = ['ears', 'eyes', 'muzzle', 'whiskers', 'head', 'posture', 'gait'];

const json = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

function toPet(r: any): Pet {
  return {
    id: r.id,
    name: r.name,
    species: r.species,
    ageMonths: r.age_months,
    photoPath: r.photo_path,
    createdAt: r.created_at,
  };
}

export function createPet(input: {
  name: string;
  species: Species;
  ageMonths: number;
  photoPath?: string | null;
  id?: string;
  createdAt?: string;
}): Pet {
  const pet: Pet = {
    id: input.id ?? nanoid(10),
    name: input.name,
    species: input.species,
    ageMonths: input.ageMonths,
    photoPath: input.photoPath ?? null,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  db()
    .prepare(
      'INSERT INTO pets (id, name, species, age_months, photo_path, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(pet.id, pet.name, pet.species, pet.ageMonths, pet.photoPath, pet.createdAt);
  return pet;
}

export function setPetPhoto(id: string, photoPath: string): void {
  db().prepare('UPDATE pets SET photo_path = ? WHERE id = ?').run(photoPath, id);
}

export function listPets(): Pet[] {
  return db().prepare('SELECT * FROM pets ORDER BY created_at').all().map(toPet);
}

export function getPet(id: string): Pet | null {
  const r = db().prepare('SELECT * FROM pets WHERE id = ?').get(id);
  return r ? toPet(r) : null;
}

export function createCheck(input: {
  petId: string;
  recordedAt?: string;
  id?: string;
  simulated?: boolean;
}): string {
  const id = input.id ?? nanoid(12);
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO checks (id, pet_id, status, stage, recorded_at, created_at, simulated)
       VALUES (?, ?, 'processing', 'ingest', ?, ?, ?)`,
    )
    .run(id, input.petId, input.recordedAt ?? now, now, input.simulated ? 1 : 0);
  return id;
}

export function setCheckStage(id: string, stage: CheckStage, status: CheckStatus = 'processing', error?: string): void {
  db()
    .prepare('UPDATE checks SET stage = ?, status = ?, error = ? WHERE id = ?')
    .run(stage, status, error ?? null, id);
}

export function updateCheck(id: string, fields: Record<string, unknown>): void {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const allowed = new Set([
    'video_path', 'duration_s', 'width', 'height', 'scale', 'raw_score', 'raw_max', 'score',
    'level', 'confidence', 'moving', 'note', 'spark_json', 'sam_json', 'models_json',
    'status', 'stage', 'error', 'simulated',
  ]);
  for (const k of keys) if (!allowed.has(k)) throw new Error(`Unknown check column ${k}`);
  const sql = `UPDATE checks SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`;
  db().prepare(sql).run({ ...fields, id });
}

export function saveFeatures(checkId: string, features: FeatureResult[]): void {
  const insert = db().prepare(
    `INSERT OR REPLACE INTO check_features (check_id, feature, score, in_total, confidence, evidence)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  db().transaction(() => {
    for (const f of features) {
      insert.run(checkId, f.feature, f.score, f.inTotal ? 1 : 0, f.confidence, f.evidence);
    }
  })();
}

export function saveKeyFrames(checkId: string, frames: KeyFrame[]): void {
  const insert = db().prepare(
    `INSERT INTO key_frames (check_id, idx, t_s, sharpness, frame_path, face_crop_path, overlay_path,
       face_box, body_box, face_conf, body_conf)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db().transaction(() => {
    db().prepare('DELETE FROM key_frames WHERE check_id = ?').run(checkId);
    for (const k of frames) {
      insert.run(
        checkId, k.idx, k.tS, k.sharpness, k.framePath, k.faceCropPath, k.overlayPath,
        k.faceBox ? JSON.stringify(k.faceBox) : null,
        k.bodyBox ? JSON.stringify(k.bodyBox) : null,
        k.faceConf, k.bodyConf,
      );
    }
  })();
}

function toCheck(r: any, features: any[], frames: any[]): Check {
  const spark = json<{ quality_issues?: string[] }>(r.spark_json);
  return {
    id: r.id,
    petId: r.pet_id,
    status: r.status,
    stage: r.stage,
    error: r.error,
    recordedAt: r.recorded_at,
    createdAt: r.created_at,
    videoPath: r.video_path,
    durationS: r.duration_s,
    scale: r.scale,
    rawScore: r.raw_score,
    rawMax: r.raw_max,
    score: r.score,
    level: r.level,
    confidence: r.confidence,
    moving: r.moving === null ? null : Boolean(r.moving),
    note: r.note,
    simulated: Boolean(r.simulated),
    models: json(r.models_json),
    qualityIssues: spark?.quality_issues ?? [],
    features: [...features].sort((a, b) => FEATURE_ORDER.indexOf(a.feature) - FEATURE_ORDER.indexOf(b.feature)).map((f) => ({
      feature: f.feature,
      score: f.score,
      inTotal: Boolean(f.in_total),
      confidence: f.confidence,
      evidence: f.evidence,
    })),
    keyFrames: frames.map((k) => ({
      idx: k.idx,
      tS: k.t_s,
      sharpness: k.sharpness,
      framePath: k.frame_path,
      faceCropPath: k.face_crop_path,
      overlayPath: k.overlay_path,
      faceBox: json<Box>(k.face_box),
      bodyBox: json<Box>(k.body_box),
      faceConf: k.face_conf,
      bodyConf: k.body_conf,
    })),
  };
}

export function getCheck(id: string): Check | null {
  const r = db().prepare('SELECT * FROM checks WHERE id = ?').get(id);
  if (!r) return null;
  const features = db().prepare('SELECT * FROM check_features WHERE check_id = ?').all(id);
  const frames = db().prepare('SELECT * FROM key_frames WHERE check_id = ? ORDER BY idx').all(id);
  return toCheck(r, features, frames);
}

/** All checks for a pet, oldest first, with features and key frames. */
export function listChecks(petId: string): Check[] {
  const rows = db().prepare('SELECT * FROM checks WHERE pet_id = ? ORDER BY recorded_at').all(petId) as any[];
  if (rows.length === 0) return [];
  const features = db()
    .prepare('SELECT f.* FROM check_features f JOIN checks c ON c.id = f.check_id WHERE c.pet_id = ?')
    .all(petId) as any[];
  const frames = db()
    .prepare('SELECT k.* FROM key_frames k JOIN checks c ON c.id = k.check_id WHERE c.pet_id = ? ORDER BY k.idx')
    .all(petId) as any[];
  return rows.map((r) =>
    toCheck(
      r,
      features.filter((f) => f.check_id === r.id),
      frames.filter((k) => k.check_id === r.id),
    ),
  );
}

function toAlert(r: any): Alert {
  return {
    id: r.id,
    petId: r.pet_id,
    kind: r.kind,
    message: r.message,
    firstDay: r.first_day,
    lastDay: r.last_day,
    createdAt: r.created_at,
    dismissedAt: r.dismissed_at,
  };
}

export function openAlerts(petId: string): Alert[] {
  return db()
    .prepare('SELECT * FROM alerts WHERE pet_id = ? AND dismissed_at IS NULL ORDER BY created_at DESC')
    .all(petId)
    .map(toAlert);
}

/**
 * Reconciles stored alerts with the freshly computed trend: extends an open
 * alert of the same kind, opens new ones, and closes those no longer true.
 * Returns alerts opened by this call, so callers can notify the owner.
 */
export function syncAlerts(
  petId: string,
  current: { kind: 'sustained' | 'rising'; message: string; firstDay: string; lastDay: string }[],
): Alert[] {
  const opened: Alert[] = [];
  const now = new Date().toISOString();
  db().transaction(() => {
    const open = openAlerts(petId);
    for (const a of open) {
      if (!current.some((c) => c.kind === a.kind)) {
        db().prepare('UPDATE alerts SET dismissed_at = ? WHERE id = ?').run(now, a.id);
      }
    }
    for (const c of current) {
      const existing = open.find((a) => a.kind === c.kind);
      if (existing) {
        db()
          .prepare('UPDATE alerts SET message = ?, last_day = ? WHERE id = ?')
          .run(c.message, c.lastDay, existing.id);
      } else {
        const info = db()
          .prepare(
            'INSERT INTO alerts (pet_id, kind, message, first_day, last_day, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(petId, c.kind, c.message, c.firstDay, c.lastDay, now);
        opened.push({ id: Number(info.lastInsertRowid), petId, ...c, createdAt: now, dismissedAt: null });
      }
    }
  })();
  return opened;
}

export function dismissAlert(petId: string, alertId: number): void {
  db()
    .prepare('UPDATE alerts SET dismissed_at = ? WHERE id = ? AND pet_id = ?')
    .run(new Date().toISOString(), alertId, petId);
}
