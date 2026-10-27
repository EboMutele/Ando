import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';

/**
 * File storage keyed by relative paths such as "checks/<id>/video.mp4".
 * Local disk today; the key-based interface maps directly onto S3/R2/GCS.
 */
const root = () => path.join(config.dataDir, 'media');

export function resolveKey(key: string): string {
  const base = root();
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error('Invalid storage key');
  return full;
}

export async function put(key: string, data: Buffer | Uint8Array): Promise<string> {
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
  return key;
}

export async function get(key: string): Promise<Buffer> {
  return fs.readFile(resolveKey(key));
}

export async function remove(prefix: string): Promise<void> {
  await fs.rm(resolveKey(prefix), { recursive: true, force: true });
}

/** URL the browser uses to fetch a stored file. */
export function mediaUrl(key: string | null): string | null {
  return key ? `/api/media/${key.split('/').map(encodeURIComponent).join('/')}` : null;
}
