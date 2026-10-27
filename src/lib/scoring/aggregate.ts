import type { Confidence, Feature, FeatureResult, Level, Species } from '../types';
import { scaleFor } from './scales';
import type { SparkAssessment } from './schema';

export interface Aggregate {
  scale: string;
  rawScore: number;
  rawMax: number;
  /** rawScore ÷ rawMax, 0–1. */
  score: number;
  level: Level;
  confidence: Confidence;
  features: FeatureResult[];
}

export interface DetectionQuality {
  /** Key frames analysed. */
  frames: number;
  /** Key frames where SAM found the pet's face. */
  faceFrames: number;
  /** Key frames where SAM found the pet's body. */
  bodyFrames: number;
}

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const BY_RANK: Confidence[] = ['low', 'medium', 'high'];

export function levelFor(species: Species, score: number): Level {
  const scale = scaleFor(species);
  if (score >= scale.elevatedAt) return 'elevated';
  if (score >= scale.mildAt) return 'mild';
  return 'none';
}

/**
 * Sums the model's item ratings the way the published scales do: items that
 * could not be scored are left out of both the total and the maximum. Gait
 * is only counted when the animal actually moved.
 * Returns null when too few items were scorable to say anything.
 */
export function aggregate(
  species: Species,
  assessment: SparkAssessment,
  quality: DetectionQuality,
): Aggregate | null {
  const scale = scaleFor(species);
  const features: FeatureResult[] = scale.features.map((rubric) => {
    const a = assessment.features[rubric.feature as Feature];
    let score = a?.score ?? null;
    if (rubric.feature === 'gait' && !assessment.pet_moving) score = null;
    return {
      feature: rubric.feature,
      score,
      inTotal: rubric.inTotal,
      confidence: a?.confidence ?? null,
      evidence: a?.evidence ?? null,
    };
  });

  const counted = features.filter((f) => f.inTotal && f.score !== null);
  const possible = scale.features.filter((f) => f.inTotal).length;
  // FGS practice: at least 3 of the 5 action units are needed for a ratio.
  if (!assessment.usable || counted.length < Math.min(3, possible)) return null;

  const rawScore = counted.reduce((sum, f) => sum + (f.score ?? 0), 0);
  const rawMax = counted.length * 2;
  const score = Math.round((rawScore / rawMax) * 1000) / 1000;

  return {
    scale: scale.id,
    rawScore,
    rawMax,
    score,
    level: levelFor(species, score),
    confidence: overallConfidence(assessment, counted.length / possible, quality),
    features,
  };
}

/**
 * The model's self-reported confidence, capped by what the footage supports:
 * how many scale items were scorable and how often SAM found the face.
 */
export function overallConfidence(
  assessment: Pick<SparkAssessment, 'overall_confidence'>,
  coverage: number,
  quality: DetectionQuality,
): Confidence {
  const faceRate = quality.frames === 0 ? 0 : quality.faceFrames / quality.frames;
  let cap: Confidence = 'high';
  if (coverage < 1 || faceRate < 0.5) cap = 'medium';
  if (coverage < 0.6 || quality.faceFrames < 2) cap = 'low';
  return BY_RANK[Math.min(RANK[assessment.overall_confidence], RANK[cap])];
}
