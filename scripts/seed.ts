/**
 * Seeds the demo pet "Luna": a 7-year-old cat with 14 days of checks. Her
 * scores sit low for nine days, then climb past the Feline Grimace Scale
 * cut-off for the last four — enough to show the trend and fire the
 * sustained alert. Key frames are illustrations drawn from each day's
 * scores (ears flatten, eyes narrow), clearly marked as demo images.
 *
 *   npm run seed
 */
import sharp from 'sharp';
import { db } from '../src/lib/db/index';
import * as repo from '../src/lib/db/repo';
import { refreshAlerts } from '../src/lib/pipeline';
import { aggregate } from '../src/lib/scoring/aggregate';
import type { SparkAssessment } from '../src/lib/scoring/schema';
import * as storage from '../src/lib/storage';
import type { Feature } from '../src/lib/types';

const PET_ID = 'luna-demo';
type S = 0 | 1 | 2;
interface Day {
  ears: S;
  eyes: S;
  muzzle: S;
  whiskers: S;
  head: S;
  posture: S;
  confidence: 'low' | 'medium' | 'high';
  note: string;
}

const calm = 'Luna looked relaxed: ears forward, eyes open and a soft, round muzzle.';
const DAYS: Day[] = [
  { ears: 0, eyes: 0, muzzle: 0, whiskers: 0, head: 0, posture: 0, confidence: 'high', note: calm },
  { ears: 0, eyes: 1, muzzle: 0, whiskers: 0, head: 0, posture: 0, confidence: 'high', note: 'Mostly relaxed. Her eyes were half closed in a couple of frames, which is common when a cat is drowsy.' },
  { ears: 0, eyes: 0, muzzle: 0, whiskers: 0, head: 0, posture: 0, confidence: 'high', note: calm },
  { ears: 1, eyes: 0, muzzle: 0, whiskers: 0, head: 0, posture: 0, confidence: 'medium', note: 'Relaxed overall; her ears were turned slightly apart for part of the clip.' },
  { ears: 0, eyes: 0, muzzle: 0, whiskers: 1, head: 0, posture: 0, confidence: 'high', note: 'Relaxed face. Whiskers were a little straighter than usual in one frame.' },
  { ears: 2, eyes: 2, muzzle: 1, whiskers: 1, head: 1, posture: 1, confidence: 'low', note: 'The light was dim and her face was turned away for most of the clip, so this reading is uncertain.' },
  { ears: 0, eyes: 0, muzzle: 0, whiskers: 0, head: 0, posture: 0, confidence: 'high', note: calm },
  { ears: 0, eyes: 1, muzzle: 0, whiskers: 0, head: 0, posture: 0, confidence: 'high', note: 'Mostly relaxed, with eyes partly closed in a few frames.' },
  { ears: 1, eyes: 0, muzzle: 1, whiskers: 0, head: 0, posture: 0, confidence: 'medium', note: 'Ears slightly apart and a little tension around the muzzle.' },
  { ears: 1, eyes: 1, muzzle: 1, whiskers: 0, head: 0, posture: 1, confidence: 'high', note: 'Ears pulled apart, eyes partly closed and mild muzzle tension. She sat hunched for part of the clip.' },
  { ears: 2, eyes: 1, muzzle: 1, whiskers: 1, head: 0, posture: 1, confidence: 'high', note: 'Ears flattened and turned outwards, eyes partly closed, and whiskers straighter than usual.' },
  { ears: 1, eyes: 2, muzzle: 1, whiskers: 1, head: 1, posture: 1, confidence: 'high', note: 'Squinting, tense muzzle and head held level with her shoulders. These signs are higher than her usual.' },
  { ears: 2, eyes: 1, muzzle: 2, whiskers: 1, head: 1, posture: 2, confidence: 'high', note: 'Flattened ears, a tense, narrow muzzle and a hunched posture throughout the clip.' },
  { ears: 2, eyes: 1, muzzle: 1, whiskers: 1, head: 1, posture: 1, confidence: 'high', note: 'Ears flattened, eyes partly closed and tension around the muzzle, similar to the last few days.' },
];

/** Line-drawn cat face whose ears, eyes, muzzle and whiskers follow the FGS ratings. */
function catFace(d: Day, variant: number, crop = false): string {
  const tilt = [0, 18, 38][d.ears];
  const drop = [0, 6, 16][d.ears];
  const eyeH = [11, 6, 2.2][d.eyes];
  const muzzleRy = [16, 13, 9][d.muzzle];
  const whiskerCurve = [10, 4, -2][d.whiskers];
  const whiskerSpread = [1, 0.75, 0.55][d.whiskers];
  const headY = [0, 18, 36][d.head] + variant * 4;
  const wx = (side: 1 | -1, i: number) => {
    const y0 = 192 + i * 9 * whiskerSpread;
    const x0 = 160 + side * 34;
    const x1 = 160 + side * 120;
    return `<path d="M${x0},${y0} Q${(x0 + x1) / 2},${y0 - whiskerCurve} ${x1},${y0 - 6 + i * 10 * whiskerSpread}" />`;
  };
  const face = `
    <g transform="translate(0 ${headY})" fill="none" stroke="#3b2f2a" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
      <g transform="rotate(${-tilt} 95 92) translate(0 ${drop})"><path d="M70,118 L88,40 L130,96" fill="#c98c5b"/></g>
      <g transform="rotate(${tilt} 225 92) translate(0 ${drop})"><path d="M250,118 L232,40 L190,96" fill="#c98c5b"/></g>
      <ellipse cx="160" cy="160" rx="104" ry="90" fill="#d9a06f"/>
      <ellipse cx="118" cy="146" rx="15" ry="${eyeH}" fill="#2f4a2a"/>
      <ellipse cx="202" cy="146" rx="15" ry="${eyeH}" fill="#2f4a2a"/>
      <ellipse cx="160" cy="198" rx="${muzzleRy * 2.2}" ry="${muzzleRy}" fill="#f1d3b3"/>
      <path d="M152,180 L168,180 L160,190 Z" fill="#9c4f4f"/>
      <g stroke-width="2.5">${[0, 1, 2].map((i) => wx(-1, i) + wx(1, i)).join('')}</g>
    </g>`;
  if (crop) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="448" height="448" viewBox="40 ${10 + headY} 240 240"><rect x="0" y="-100" width="400" height="600" fill="#efe6da"/>${face}</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="-160 -40 640 480">
    <rect x="-160" y="-40" width="640" height="480" fill="#efe6da"/>
    <ellipse cx="160" cy="${360 + [0, 6, 14][d.posture]}" rx="${190 - d.posture * 14}" ry="${110 - d.posture * 8}" fill="#c98c5b" stroke="#3b2f2a" stroke-width="5"/>
    ${face}
    <text x="-140" y="420" font-family="sans-serif" font-size="20" fill="#7a6a5e">Demo illustration</text>
  </svg>`;
}

const jpeg = (svg: string) => sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();

async function main() {
  db().prepare('DELETE FROM pets WHERE id = ?').run(PET_ID);
  await storage.remove(`pets/${PET_ID}`);

  const photoKey = await storage.put(`pets/${PET_ID}/photo.jpg`, await sharp(await jpeg(catFace(DAYS[0], 0, true))).resize(512, 512).jpeg().toBuffer());
  const created = new Date(Date.now() - 15 * 86_400_000);
  const pet = repo.createPet({ id: PET_ID, name: 'Luna', species: 'cat', ageMonths: 7 * 12 + 4, photoPath: photoKey, createdAt: created.toISOString() });

  for (let i = 0; i < DAYS.length; i++) {
    const d = DAYS[i];
    const when = new Date();
    when.setDate(when.getDate() - (DAYS.length - 1 - i));
    when.setHours(8 + (i % 3), 10 + ((i * 7) % 40), 0, 0);
    const checkId = `luna-${String(i + 1).padStart(2, '0')}`;
    await storage.remove(`checks/${checkId}`);
    repo.createCheck({ id: checkId, petId: pet.id, recordedAt: when.toISOString(), simulated: true });

    const frames = [];
    for (let k = 0; k < 3; k++) {
      const base = `checks/${checkId}/frame-${k + 1}`;
      const full = await jpeg(catFace(d, k));
      await storage.put(`${base}.jpg`, full);
      await storage.put(`${base}-face.jpg`, await jpeg(catFace(d, k, true)));
      frames.push({
        idx: k + 1, tS: 1.5 + k * 3.5, sharpness: 900, framePath: `${base}.jpg`, faceCropPath: `${base}-face.jpg`,
        overlayPath: null, faceBox: { left: 216, top: 94 + k * 4, right: 424, bottom: 250 + k * 4 },
        bodyBox: { left: 120, top: 60, right: 520, bottom: 470 }, faceConf: 0.93, bodyConf: 0.97,
      });
    }
    repo.saveKeyFrames(checkId, frames);

    const features = Object.fromEntries(
      (['ears', 'eyes', 'muzzle', 'whiskers', 'head', 'posture', 'gait'] as Feature[]).map((f) => [
        f,
        {
          score: f === 'gait' ? null : d[f as Exclude<Feature, 'gait'>],
          confidence: d.confidence,
          evidence: f === 'gait' ? 'Luna stayed seated, so gait was not assessed.' : 'Demo data (frames 1–3).',
          frames: [1, 2, 3],
        },
      ]),
    );
    const assessment: SparkAssessment = {
      usable: true, exclusion: null, pet_moving: false, features, overall_confidence: d.confidence,
      quality_issues: d.confidence === 'low' ? ['Dim lighting', 'Face turned away in most frames'] : [], note: d.note,
    };
    const quality = d.confidence === 'low' ? { frames: 3, faceFrames: 1, bodyFrames: 3 } : { frames: 3, faceFrames: 3, bodyFrames: 3 };
    const r = aggregate('cat', assessment, quality)!;
    repo.saveFeatures(checkId, r.features);
    repo.updateCheck(checkId, {
      status: 'done', stage: 'done', duration_s: 10, width: 640, height: 480, scale: r.scale,
      raw_score: r.rawScore, raw_max: r.rawMax, score: r.score, level: r.level, confidence: r.confidence,
      moving: 0, note: d.note, spark_json: JSON.stringify(assessment), sam_json: JSON.stringify(quality),
      models_json: JSON.stringify({ sam: 'demo', spark: 'demo' }),
    });
  }

  const opened = refreshAlerts(pet);
  const checks = repo.listChecks(pet.id);
  console.log(`Seeded Luna (${pet.id}) with ${checks.length} checks: ${checks.map((c) => c.rawScore).join(' ')}`);
  console.log(`Open alerts: ${repo.openAlerts(pet.id).map((a) => a.kind).join(', ') || 'none'}${opened.length ? ' (new)' : ''}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
