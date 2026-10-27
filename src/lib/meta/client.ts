import OpenAI from 'openai';
import { config } from '../config';

let client: OpenAI | undefined;

/**
 * The Meta Model API is OpenAI-compatible, so the official OpenAI SDK is the
 * client: only the base URL and key change. The key never leaves the server.
 */
export function meta(): OpenAI {
  if (client) return client;
  const apiKey = config.modelApiKey;
  if (!apiKey) {
    throw new MetaConfigError('MODEL_API_KEY is not set. Add it to .env.local (see .env.example).');
  }
  client = new OpenAI({ apiKey, baseURL: config.metaBaseURL, maxRetries: 2, timeout: 120_000 });
  return client;
}

export class MetaConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaConfigError';
  }
}

/** Runs async tasks with at most `limit` in flight (API rate limits). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function dataUrl(bytes: Buffer, mime = 'image/jpeg'): string {
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
