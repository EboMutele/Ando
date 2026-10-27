import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  species     TEXT NOT NULL CHECK (species IN ('cat', 'dog')),
  age_months  INTEGER NOT NULL CHECK (age_months >= 0),
  photo_path  TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checks (
  id           TEXT PRIMARY KEY,
  pet_id       TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('processing', 'done', 'unusable', 'failed')),
  stage        TEXT NOT NULL,
  error        TEXT,
  recorded_at  TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  video_path   TEXT,
  duration_s   REAL,
  width        INTEGER,
  height       INTEGER,
  scale        TEXT,
  raw_score    REAL,
  raw_max      REAL,
  score        REAL,
  level        TEXT CHECK (level IN ('none', 'mild', 'elevated')),
  confidence   TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  moving       INTEGER,
  note         TEXT,
  spark_json   TEXT,
  sam_json     TEXT,
  models_json  TEXT,
  simulated    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS checks_pet_time ON checks (pet_id, recorded_at);

CREATE TABLE IF NOT EXISTS check_features (
  check_id    TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  feature     TEXT NOT NULL,
  score       INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 2),
  in_total    INTEGER NOT NULL,
  confidence  TEXT,
  evidence    TEXT,
  PRIMARY KEY (check_id, feature)
);

CREATE TABLE IF NOT EXISTS key_frames (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id        TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  idx             INTEGER NOT NULL,
  t_s             REAL NOT NULL,
  sharpness       REAL,
  frame_path      TEXT NOT NULL,
  face_crop_path  TEXT,
  overlay_path    TEXT,
  face_box        TEXT,
  body_box        TEXT,
  face_conf       REAL,
  body_conf       REAL
);
CREATE INDEX IF NOT EXISTS key_frames_check ON key_frames (check_id, idx);

CREATE TABLE IF NOT EXISTS alerts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pet_id        TEXT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('sustained', 'rising')),
  message       TEXT NOT NULL,
  first_day     TEXT NOT NULL,
  last_day      TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  dismissed_at  TEXT
);
CREATE INDEX IF NOT EXISTS alerts_pet ON alerts (pet_id, dismissed_at);
`;

let instance: Database.Database | undefined;

export function db(): Database.Database {
  if (instance) return instance;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = process.env.DATABASE_PATH ?? path.join(config.dataDir, 'ando.db');
  instance = new Database(file);
  instance.pragma('journal_mode = WAL');
  instance.pragma('foreign_keys = ON');
  instance.exec(SCHEMA);
  // Analysis runs in-process; a restart mid-check would leave it spinning forever.
  instance
    .prepare(
      `UPDATE checks SET status = 'failed', stage = 'done', error = 'Analysis was interrupted. Please try the clip again.'
       WHERE status = 'processing' AND created_at < ?`,
    )
    .run(new Date(Date.now() - 10 * 60_000).toISOString());
  return instance;
}

/** Test helper: drop the cached connection so a new DATABASE_PATH takes effect. */
export function resetDbForTests(): void {
  instance?.close();
  instance = undefined;
}
