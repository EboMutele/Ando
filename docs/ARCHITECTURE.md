# Ando — architecture

Ando turns a 5–15 s phone video of a cat or dog into a structured pain-signal
check, scored against published veterinary pain scales, and tracks it over
time. It is a screening aid, **not a diagnosis**.

## Pipeline

```
 phone video (5–15 s)
      │  POST /api/pets/:id/checks  (multipart)
      ▼
 ┌──────────────┐  ffprobe: duration, size, streams
 │ 1. ingest    │  ffmpeg: transcode → H.264 MP4, ≤720p, audio stripped
 └──────┬───────┘
        ▼
 ┌──────────────┐  sample at 2 fps, score sharpness (Laplacian variance),
 │ 2. keyframes │  pick the 6 sharpest frames spread across the clip
 └──────┬───────┘
        ▼
 ┌──────────────┐  SAM 3.1 (Responses API, unary image requests), two
 │ 3. segment   │  concept prompts per frame: "<species> face", "<species>"
 │   SAM 3.1    │  → boxes + masks + confidence; face crops + mask overlays;
 └──────┬───────┘  quality gate (no pet visible → "retake", never a score)
        ▼
 ┌──────────────┐  Muse Spark (Chat Completions, json_schema output):
 │ 4. score     │  species rubric + full frames + face crops + SAM geometry
 │  Muse Spark  │  → per-feature 0/1/2 (or null when not visible), evidence,
 └──────┬───────┘  confidence, plain-language note
        ▼
 ┌──────────────┐  server computes the total exactly as the published scale
 │ 5. aggregate │  does (sum of scored items ÷ max of scored items), maps to
 │  + trend     │  a concern level, recomputes trend + sustained-elevation alert
 └──────┬───────┘
        ▼
  result page · trend chart · alert banner · PDF vet report
  (6. Muse Image summary card — see docs/MUSE_IMAGE.md)
```

The model never does arithmetic that matters: Spark rates each facial action
unit / behaviour; the server sums. Totals, thresholds and alerts are
deterministic and unit-tested.

## Folder structure

```
src/
  app/                          Next.js App Router (mobile-first UI + API)
    page.tsx                    pet list
    pets/new/page.tsx           add a pet
    pets/[petId]/page.tsx       trend, alert, history, "New check"
    pets/[petId]/check/page.tsx record / upload a clip
    checks/[checkId]/page.tsx   result (polls while processing)
    api/
      pets/route.ts                       GET list, POST create (multipart w/ photo)
      pets/[petId]/route.ts               GET pet + checks + trend
      pets/[petId]/checks/route.ts        POST video → starts pipeline
      pets/[petId]/report/route.ts        GET one-page PDF
      checks/[checkId]/route.ts           GET status / result
      media/[...path]/route.ts            serve stored files (traversal-safe)
  components/                   TrendChart, FeatureGrid, Disclaimer, AlertBanner …
  lib/
    db/                         SQLite (better-sqlite3): schema, migrations, repo
    storage.ts                  file storage (local dir; S3-shaped interface)
    video/                      ffprobe/ffmpeg wrappers, key-frame selection
    meta/
      client.ts                 OpenAI SDK pointed at the Meta Model API
      sam.ts                    SAM 3.1 requests + @meta-sam/parser decoding
      spark.ts                  Muse Spark scoring request
      museImage.ts              Muse Image client (disabled until access)
    scoring/
      scales.ts                 FGS + Glasgow CMPS-SF-derived rubrics
      schema.ts                 Spark output JSON Schema + zod validator
      aggregate.ts              totals, concern level, confidence
    trend.ts                    daily series, baseline, alert rules
    pipeline.ts                 orchestrates stages, persists progress
    report/pdf.ts               one-page vet report (pdfkit)
scripts/
  seed.ts                       demo pet "Luna", 14 days of checks
  mock-meta.ts                  local stand-in for the Meta API (dev/tests)
tests/                          vitest: parser, scoring, trend, API contract
storage/                        uploaded videos, frames, crops (git-ignored)
```

## Data model (SQLite)

```
pets
  id TEXT PK · name · species ('cat'|'dog') · age_months INT
  photo_path · created_at

checks
  id TEXT PK · pet_id → pets
  status  ('processing'|'done'|'unusable'|'failed')
  stage   ('ingest'|'keyframes'|'segment'|'score'|'done')
  error · recorded_at · created_at
  video_path · duration_s · width · height
  scale        ('FGS'|'CMPS-SF-derived')
  raw_score · raw_max · score (0–1 normalized) · level ('none'|'mild'|'elevated')
  confidence ('low'|'medium'|'high') · moving BOOL · note
  spark_json (validated model output) · sam_json (detection summary)
  models_json (exact model IDs used) · simulated BOOL (mock API)

check_features                 one row per feature per check
  check_id → checks · feature ('ears'|'eyes'|'muzzle'|'whiskers'|'head'|'posture'|'gait')
  score (0|1|2|NULL when not visible) · in_total BOOL · confidence · evidence

key_frames
  id PK · check_id → checks · idx · t_s · sharpness
  frame_path · face_crop_path · overlay_path
  face_box · body_box (JSON, source px) · face_conf · body_conf

alerts
  id PK · pet_id → pets · kind ('sustained'|'rising') · message
  first_day · last_day · created_at · dismissed_at
```

Feature scores live in their own table (not only in JSON) so per-feature
trends ("ears have been flattening for a week") are a single query.

## Scoring rules

| Species | Scale | Items in total | Cut-off |
| --- | --- | --- | --- |
| Cat | Feline Grimace Scale (Evangelista et al., 2019) | ears, eyes (orbital tightening), muzzle tension, whiskers, head position — 0/1/2 each, max 10 | ≥ 4/10 (0.40) → elevated |
| Dog | Video-observable items derived from Glasgow CMPS-SF (Reid et al., 2007) | posture, gait/mobility, head carriage, plus facial cues (ears, eyes, muzzle) | ≥ 0.30 → elevated (provisional) |

Items the model cannot see are `null` and are excluded from both numerator and
denominator — the FGS's own rule for unscorable action units. Posture and
gait are recorded for cats but are not part of the FGS total.

The Glasgow CMPS-SF is an interactive scale (it includes touching the painful
area and walking the dog on a lead). A video can only observe part of it, so
Ando labels the dog score "derived from" the CMPS-SF, never "a CMPS-SF score".

## Alert rules (src/lib/trend.ts)

* Daily value = mean score of that day's checks, ignoring low-confidence ones.
* Baseline = median of the pet's first 5 qualifying days (needs ≥ 3).
* A day is **raised** when its value ≥ the species cut-off, or ≥ baseline + 0.20.
* **Sustained alert**: ≥ 3 raised days within the last 5 days that have checks,
  including the most recent one.
* **Rising notice** (softer early signal): least-squares slope over the last
  14 days ≥ +0.02/day with ≥ 5 days of data.
