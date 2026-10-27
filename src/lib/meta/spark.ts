import type OpenAI from 'openai';
import { config } from '../config';
import { scaleFor } from '../scoring/scales';
import { sparkAssessmentJsonSchema, sparkAssessmentValidator, type SparkAssessment } from '../scoring/schema';
import type { Box, Species } from '../types';
import { dataUrl, meta } from './client';

/**
 * Muse Spark scores the clip through the OpenAI-compatible Chat Completions
 * endpoint: key frames and SAM face crops go in as image_url content parts,
 * and response_format carries a strict JSON Schema so the reply is
 * machine-readable (dev.meta.ai/docs/cookbook/structured-output).
 */

export interface SparkFrame {
  /** 1-based, as the model is told to cite it. */
  n: number;
  tS: number;
  frame: Buffer;
  faceCrop: Buffer | null;
  faceBox: Box | null;
  bodyBox: Box | null;
  width: number;
  height: number;
}

export interface SparkInput {
  species: Species;
  petName: string;
  ageMonths: number;
  frames: SparkFrame[];
  /** Body-centroid travel across the clip ÷ body width, from SAM boxes. */
  motionIndex: number | null;
}

const DIAGNOSIS_WORDS = /\b(diagnos\w*|arthritis|osteoarthritis|infection|disease|fracture|cancer|tumou?r|dysplasia|pancreatitis|cystitis)\b/i;

export function systemPrompt(species: Species): string {
  const scale = scaleFor(species);
  const rubric = scale.features
    .map(
      (f) =>
        `- ${f.feature} — ${f.label}${f.inTotal ? '' : ' [recorded, not part of the scale total]'}\n` +
        f.anchors.map((a, i) => `    ${i} = ${a}`).join('\n'),
    )
    .join('\n');
  return [
    `You are a veterinary pain-assessment assistant. You rate a short video of a ${species} using the ${scale.name}.`,
    `Source: ${scale.citation}`,
    '',
    'Rate each feature 0, 1 or 2 using these anchors:',
    rubric,
    '',
    'Rules:',
    '- Rate only what you can see. If a feature is hidden, out of frame, blurred or ambiguous in every frame, its score is null. Never guess.',
    '- Rate the expression shown in most frames, not a single fleeting moment.',
    '- gait: rate it only if the animal walks or changes position; otherwise null, and pet_moving is false.',
    `- The scale must not be applied when ${scale.exclusions.join(', or ')}. In that case set usable to false and name the exclusion.`,
    '- Set usable to false if the animal is not clearly visible in at least two frames.',
    '- Breed shapes the resting face (flat-faced breeds, droopy ears). Judge change from a relaxed expression for this kind of animal, not breed features.',
    '- The face close-ups come from SAM 3.1 segmentation of the same frame; use them for ears, eyes, muzzle and whiskers, and the full frames for head position, posture and gait.',
    '- evidence: one short sentence per feature, citing frame numbers.',
    '- note: two or three calm, plain-language sentences to the owner about what you observed. Never name a disease, injury or diagnosis, and never say the animal is fine or is in pain for certain.',
  ].join('\n');
}

function describeBox(b: Box | null, w: number, h: number): string {
  if (!b) return 'not found';
  const pct = (v: number, of: number) => `${Math.round((v / of) * 100)}%`;
  return `x ${pct(b.left, w)}–${pct(b.right, w)}, y ${pct(b.top, h)}–${pct(b.bottom, h)}`;
}

export function buildSparkMessages(input: SparkInput): OpenAI.Chat.ChatCompletionMessageParam[] {
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text:
        `Pet: ${input.petName}, ${input.species}, ${Math.floor(input.ageMonths / 12)} y ${input.ageMonths % 12} m.\n` +
        `${input.frames.length} key frames from a ${input.frames.at(-1)?.tS.toFixed(1) ?? '?'} s clip, in time order.\n` +
        (input.motionIndex === null
          ? ''
          : `SAM body tracking: the body moved ${input.motionIndex.toFixed(2)} body-widths across the clip (above ~0.5 usually means walking).\n`),
    },
  ];
  for (const f of input.frames) {
    content.push({
      type: 'text',
      text: `Frame ${f.n} at ${f.tS.toFixed(1)} s — full frame. SAM 3.1: body ${describeBox(f.bodyBox, f.width, f.height)}; face ${describeBox(f.faceBox, f.width, f.height)}.`,
    });
    content.push({ type: 'image_url', image_url: { url: dataUrl(f.frame) } });
    if (f.faceCrop) {
      content.push({ type: 'text', text: `Frame ${f.n} — face close-up.` });
      content.push({ type: 'image_url', image_url: { url: dataUrl(f.faceCrop) } });
    }
  }
  content.push({ type: 'text', text: 'Return the assessment as JSON matching the schema.' });
  return [
    { role: 'system', content: systemPrompt(input.species) },
    { role: 'user', content },
  ];
}

export function buildSparkRequest(input: SparkInput): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  return {
    model: config.sparkModel,
    messages: buildSparkMessages(input),
    temperature: 0.2,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: `${input.species}_pain_assessment`,
        strict: true,
        schema: sparkAssessmentJsonSchema(input.species),
      },
    },
  };
}

export class SparkOutputError extends Error {
  constructor(message: string, readonly raw: string) {
    super(message);
    this.name = 'SparkOutputError';
  }
}

/** Parses and validates a reply; returns a reason string when it must be retried. */
export function readAssessment(species: Species, raw: string): SparkAssessment | string {
  let parsed: unknown;
  try {
    // Some deployments wrap JSON in a code fence even with response_format.
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return 'The reply was not valid JSON.';
  }
  const result = sparkAssessmentValidator(species).safeParse(parsed);
  if (!result.success) return `The reply did not match the schema: ${result.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
  if (DIAGNOSIS_WORDS.test(result.data.note)) return 'The note named a condition. Describe observations only.';
  return result.data as SparkAssessment;
}

export async function scoreWithSpark(input: SparkInput): Promise<{ assessment: SparkAssessment; model: string }> {
  const request = buildSparkRequest(input);
  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await meta().chat.completions.create(request);
    const choice = completion.choices[0];
    if (choice?.message?.refusal) throw new SparkOutputError(`Muse Spark declined: ${choice.message.refusal}`, '');
    lastRaw = choice?.message?.content ?? '';
    const result = readAssessment(input.species, lastRaw);
    if (typeof result !== 'string') return { assessment: result, model: completion.model || config.sparkModel };
    // One corrective retry with the problem stated.
    request.messages = [
      ...buildSparkMessages(input),
      { role: 'assistant', content: lastRaw },
      { role: 'user', content: `${result} Return corrected JSON only.` },
    ];
  }
  throw new SparkOutputError('Muse Spark did not return a valid assessment.', lastRaw);
}
