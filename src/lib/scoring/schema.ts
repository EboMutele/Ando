import { z } from 'zod';
import type { Feature, Species } from '../types';
import { featuresFor } from './scales';

const confidence = z.enum(['low', 'medium', 'high']);

const featureAssessment = z.object({
  score: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]),
  confidence,
  evidence: z.string().max(400),
  frames: z.array(z.number().int().min(1)).max(12),
});

export type FeatureAssessment = z.infer<typeof featureAssessment>;

export interface SparkAssessment {
  usable: boolean;
  exclusion: string | null;
  pet_moving: boolean;
  features: Partial<Record<Feature, FeatureAssessment>>;
  overall_confidence: z.infer<typeof confidence>;
  quality_issues: string[];
  note: string;
}

export function sparkAssessmentValidator(species: Species) {
  const keys = featuresFor(species);
  const shape = Object.fromEntries(keys.map((k) => [k, featureAssessment])) as Record<
    Feature,
    typeof featureAssessment
  >;
  return z.object({
    usable: z.boolean(),
    exclusion: z.string().max(200).nullable(),
    pet_moving: z.boolean(),
    features: z.object(shape).strict(),
    overall_confidence: confidence,
    quality_issues: z.array(z.string().max(160)).max(6),
    note: z.string().min(1).max(600),
  });
}

/**
 * JSON Schema sent as response_format. Written by hand in the strict subset
 * (every property required, no additionalProperties) so the API can constrain
 * decoding; nullable values use a type union.
 */
export function sparkAssessmentJsonSchema(species: Species): Record<string, unknown> {
  const featureSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'confidence', 'evidence', 'frames'],
    properties: {
      score: {
        type: ['integer', 'null'],
        enum: [0, 1, 2, null],
        description: '0, 1 or 2 per the rubric anchors; null when the feature is not visible enough to score.',
      },
      confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      evidence: {
        type: 'string',
        description: 'One short sentence describing what you saw, citing frame numbers.',
      },
      frames: {
        type: 'array',
        items: { type: 'integer' },
        description: 'Frame numbers (1-based) the score is based on.',
      },
    },
  };
  const keys = featuresFor(species);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['usable', 'exclusion', 'pet_moving', 'features', 'overall_confidence', 'quality_issues', 'note'],
    properties: {
      usable: {
        type: 'boolean',
        description: 'False if the animal is not visible enough, or an exclusion applies, to score the clip at all.',
      },
      exclusion: {
        type: ['string', 'null'],
        description: 'Which exclusion applies (e.g. "asleep"), or null.',
      },
      pet_moving: { type: 'boolean', description: 'True if the animal walks or changes position during the clip.' },
      features: {
        type: 'object',
        additionalProperties: false,
        required: keys,
        properties: Object.fromEntries(keys.map((k) => [k, featureSchema])),
      },
      overall_confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
      quality_issues: {
        type: 'array',
        items: { type: 'string' },
        description: 'Problems with the footage (blur, lighting, face hidden). Empty if none.',
      },
      note: {
        type: 'string',
        description:
          'Two or three plain-language sentences for the owner. Describe what was observed. Never name a disease or diagnosis.',
      },
    },
  };
}
