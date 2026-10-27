import { toFile } from 'openai';
import { config } from '../config';
import type { Level, Pet } from '../types';
import { meta } from './client';

/**
 * Muse Image (muse-image-1.0) draws only the illustration on the trend card.
 * Numbers, dates and the chart are composited by Ando (src/lib/report/card.ts),
 * so no model ever renders data. Disabled until MUSE_IMAGE_ENABLED=true; see
 * docs/MUSE_IMAGE.md for the plan and what to verify against Meta's docs.
 *
 * Endpoints (dev.meta.ai/docs/image-generation, OpenAI Images-compatible):
 *   POST /v1/images/edits        reference photo → stylized portrait
 *   POST /v1/images/generations  text only, when there is no photo
 */

const MOOD: Record<Level, string> = {
  none: 'relaxed and content, soft morning light',
  mild: 'resting quietly on a soft blanket, gentle light',
  elevated: 'resting comfortably on a cushion, calm and cared for, warm light',
};

export function cardPrompt(pet: Pick<Pet, 'name' | 'species'>, level: Level): string {
  // Never depict distress, injury or medical scenes: the card is shared with family.
  return [
    `A warm, minimal flat illustration of this ${pet.species}, ${MOOD[level]}.`,
    'Keep the animal\'s coat colours and markings from the reference photo.',
    'Plain pale background, lots of empty space on the right, no text, no letters, no numbers, no medical equipment.',
  ].join(' ');
}

export async function generateCardIllustration(pet: Pet, level: Level, photo: Buffer | null): Promise<Buffer | null> {
  if (!config.museImageEnabled) return null;
  const prompt = cardPrompt(pet, level);
  const result = photo
    ? await meta().images.edit({
        model: config.museImageModel,
        image: await toFile(photo, 'pet.jpg', { type: 'image/jpeg' }),
        prompt,
        response_format: 'b64_json',
      })
    : await meta().images.generate({ model: config.museImageModel, prompt, n: 1, response_format: 'b64_json' });
  const b64 = result.data?.[0]?.b64_json;
  return b64 ? Buffer.from(b64, 'base64') : null;
}
