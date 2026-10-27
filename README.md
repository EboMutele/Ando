# Ando

**Early pain signals for cats and dogs, from a 5–15 second phone video.**

Pain in pets is easy to miss. Cats in particular hide it, and owners often notice
only when it is advanced. Vets use validated facial and behavioural pain scales, but
owners don't. Ando applies those scales to short videos the owner records at home,
tracks the result day by day, and says when it's time to see a vet.

> **Not a diagnosis. If you're worried, see a vet.** Ando is a screening aid. It
> never names a condition, and every result carries this line.

Built for the Meta Global AI Developer Hackathon (Indie track) using three models on
the Meta Model API: **SAM 3.1**, **Muse Spark** and **Muse Image**.

## How it works

```
video ─► ffmpeg ─► 6 sharpest key frames ─► SAM 3.1 ─► face crops + masks ─► Muse Spark ─► item scores
                                             │                                               │
                                     quality gate: no pet,                        server sums them like the
                                     no score                                     published scale ─► trend ─► alert
                                                                                                    │
                                                                       PDF vet report ◄─────────────┤
                                                       summary card (Muse Image art + Ando data) ◄──┘
```

1. **Add a pet**: name, cat or dog, age, photo.
2. **Record or upload a 5–15 s clip.** Length is checked in the browser and again on
   the server (ffprobe). The clip is converted to H.264 MP4 at 720p or less, with
   rotation applied and **audio removed** (it isn't scored, and removing it keeps
   home audio private).
3. **Key frames**: frames are sampled at 2 fps, each is scored for sharpness
   (variance of the Laplacian), and the sharpest frame from each sixth of the clip is
   kept. This gives six in-focus frames spread over the whole clip.
4. **SAM 3.1** segments the pet's **body** and **face** in every key frame. Ando
   crops the face at full resolution (so ears, eyes and whiskers are readable) and
   draws the masks over the frame. If SAM can't find the pet in at least two frames,
   the clip is marked "couldn't score" instead of getting a guessed score.
5. **Muse Spark** rates each item of the scale (0, 1 or 2, or `null` when it isn't
   visible) from the full frames and face crops, with the rubric anchors in the
   prompt. It returns strict JSON with a score, confidence, evidence (citing frame
   numbers) and a short plain-language note.
6. **Ando computes the total**, not the model: the sum of the scored items divided by
   the maximum of the scored items, as the Feline Grimace Scale does when an action
   unit can't be scored. Confidence is the model's own rating, capped by how much was
   visible.
7. **Trend and alerts**: each day gets a value, the pet gets a personal baseline, and
   an alert fires when scores stay raised (rules below).
8. **Exports**: a one-page **PDF vet report** and a shareable **summary card**.

## Pain scales

| | Cats | Dogs |
| --- | --- | --- |
| Scale | **Feline Grimace Scale** (Evangelista et al., *Sci Rep* 2019) | Items **derived from the Glasgow CMPS-SF** (Reid et al., *Animal Welfare* 2007) |
| Items in the total | ear position, orbital tightening, muzzle tension, whiskers, head position | ears, eyes, muzzle, head carriage, posture, mobility/gait |
| Recorded, not in the total | posture, gait | — |
| "Raised" cut-off | ratio ≥ 0.39 (the published 4/10 analgesia threshold) | ≥ 0.30 (provisional) |
| Not applied when | asleep, eating, grooming, yawning | asleep, eating, playing, being handled |

The CMPS-SF is an interactive scale: part of it involves touching the painful area
and walking the dog on a lead. A video can only observe some of it, so Ando calls the
dog score *derived from* the CMPS-SF and treats the dog cut-off as provisional until
it has been checked against vet assessments.

**Alert rules** (`src/lib/trend.ts`, unit-tested):

* Daily value = the mean of that day's checks. Low-confidence checks are shown in
  history but ignored.
* Baseline = the median of the pet's first 5 qualifying days. Breeds rest with
  different faces (a Persian's "relaxed" isn't a Siamese's), so change from the pet's
  own baseline matters as much as the population cut-off.
* A day is *raised* when its value is ≥ the cut-off, or ≥ the baseline + 0.2.
* **Sustained alert**: 3 or more raised days among the last 5 days with checks,
  including the latest.
* **Rising notice**: a 14-day slope of +0.02/day or more, with at least 5 days of data.

## How each Meta model is used

All calls go through the official **OpenAI SDK** pointed at the Meta Model API
(`src/lib/meta/client.ts`). The key is read from `MODEL_API_KEY` on the server only.

| Model | ID | Endpoint | Where | What it does |
| --- | --- | --- | --- | --- |
| **SAM 3.1** | `sam-3.1` | `POST /v1/responses` (unary, `stream: false`) | `src/lib/meta/sam.ts` | Per key frame, one request per noun-phrase concept: `"cat face"` and `"cat"` (or `"dog …"`). The image is sent inline as a data-URL `input_image`, with `metadata: { include_confidence: "true" }`. The output is SAM's token text (`<0f>id<\|box;…\|><\|mask;…\|>`), decoded with Meta's [`@meta-sam/parser`](https://www.npmjs.com/package/@meta-sam/parser). |
| **Muse Spark** | `muse-spark-1.3` | `POST /v1/chat/completions` | `src/lib/meta/spark.ts` | System prompt holds the scale's rubric anchors and exclusions. The user message holds up to 6 full frames and 6 SAM face crops as `image_url` parts, plus SAM geometry and a body-motion index. `response_format: { type: "json_schema", strict: true }` with the schema in `src/lib/scoring/schema.ts`. Replies are re-validated with zod. On a bad reply (invalid JSON, schema mismatch, or a note that names a condition) Ando makes one corrective retry. |
| **Muse Image** | `muse-image-1.0` | `POST /v1/images/edits` (with the pet photo) or `/v1/images/generations` | `src/lib/meta/museImage.ts`, `src/lib/report/card.ts` | Draws **only the illustration** on the summary card. Ando renders all numbers and the chart itself. Off until `MUSE_IMAGE_ENABLED=true`; see [docs/MUSE_IMAGE.md](docs/MUSE_IMAGE.md). |

Sources for request shapes: Meta's quickstart (base URL `https://api.meta.ai/v1`,
model IDs), the structured-output cookbook (Spark `response_format`), and Meta's
reference SAM client, [`meta-models/meta-sam`](https://github.com/meta-models/meta-sam)
(`protocol/sam3.md` and the API playground's `openai-request.ts`), which Ando's SAM
request mirrors field for field. All IDs can be overridden with env variables.

## Setup

Requirements: **Node 20.17+** (22 recommended) and **ffmpeg/ffprobe** on the PATH
(`brew install ffmpeg`, or `apt install ffmpeg`).

```bash
npm install
cp .env.example .env.local      # add MODEL_API_KEY
npm run seed                    # demo cat "Luna": 14 days of checks + an active alert
npm run dev                     # http://localhost:3000
```

Open it on your phone on the same network (`npm run dev -- -H 0.0.0.0`, then
`http://<your-ip>:3000`). The **Record** button opens the rear camera.

### Without a key: local mock API

`scripts/mock-meta.ts` stands in for the Meta API with the same wire formats (valid
SAM token text and masks, Chat Completions JSON, Images responses). Its results are
fake, so every check made against it is flagged **Demo data** in the UI.

```bash
npm run mock-meta                                                  # :8787
META_BASE_URL=http://127.0.0.1:8787/v1 MODEL_API_KEY=mock npm run dev
```

### Environment

| Variable | Default | |
| --- | --- | --- |
| `MODEL_API_KEY` | — | Meta Model API key (server only) |
| `META_BASE_URL` | `https://api.meta.ai/v1` | |
| `SPARK_MODEL` / `SAM_MODEL` / `MUSE_IMAGE_MODEL` | `muse-spark-1.3` / `sam-3.1` / `muse-image-1.0` | |
| `MUSE_IMAGE_ENABLED` | `false` | Use Muse Image for the card illustration |
| `DATA_DIR` | `./storage` | SQLite file + media (videos, frames, crops) |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | |

## Scripts

| | |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest: scoring math, trend/alert rules, Spark output contract, SAM decoding of a **captured live SAM 3.1 response**, the full pipeline (ffmpeg → SAM → Spark) through the real OpenAI SDK against the mock, the one-page PDF and the card |
| `npm run typecheck` / `lint` | |
| `npm run seed` | (Re)create Luna |
| `npm run mock-meta` | Local API stand-in |

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the folder structure, data model
and pipeline. In short: `src/app` holds pages and API routes, `src/lib/meta` the
model clients, `src/lib/scoring` the scales, schema and totals, `src/lib/trend.ts` the
alerts, `src/lib/report` the PDF and card, and `src/lib/db` SQLite.

## Data and privacy

* Videos, frames and the SQLite database live in `DATA_DIR`. Storage is addressed by
  key (`checks/<id>/video.mp4`), so moving to S3/R2 means changing
  `src/lib/storage.ts` only.
* Audio is removed on upload. Original uploads are deleted after conversion.
* Only key-frame images (not the video) are sent to the Meta Model API.
* There are no user accounts yet: this is a single-owner MVP. Add auth before any
  shared deployment.

## Deployment notes

Analysis runs in the background inside the Node process, and it needs ffmpeg and a
writable disk. Deploy to a long-running Node host (Fly.io, Render, Railway, a VM)
with a persistent volume for `DATA_DIR`, not to serverless functions.

## Known limits and what to validate next

* **Not clinically validated.** The FGS is validated for live observation and stills
  of awake cats. Applying it to owner phone video through an AI model needs its own
  validation. Next step: score ~50 clips with both Ando and a vet and report
  agreement (weighted κ per item, Bland–Altman on totals) before tuning cut-offs.
* Dog scoring covers only part of the CMPS-SF, and its cut-off is provisional.
* SAM concept prompts are chosen per species. Multi-pet homes are handled by picking
  the most confident body and the face inside it, but no identity check is made
  across days.
* Muse Image hasn't been run against the live API yet ([plan](docs/MUSE_IMAGE.md)).
