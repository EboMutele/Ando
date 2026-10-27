import path from 'node:path';

/**
 * Server-side configuration. Model IDs and the base URL come from Meta's docs
 * (dev.meta.ai/docs/quickstart, /docs/sam, /docs/image-generation) and can be
 * overridden without a code change when Meta ships a new version.
 */
export const config = {
  metaBaseURL: process.env.META_BASE_URL ?? 'https://api.meta.ai/v1',
  // Read lazily so a missing key fails the request that needs it, not the build.
  get modelApiKey(): string | undefined {
    return process.env.MODEL_API_KEY || undefined;
  },
  sparkModel: process.env.SPARK_MODEL ?? 'muse-spark-1.3',
  samModel: process.env.SAM_MODEL ?? 'sam-3.1',
  museImageModel: process.env.MUSE_IMAGE_MODEL ?? 'muse-image-1.0',
  museImageEnabled: process.env.MUSE_IMAGE_ENABLED === 'true',
  dataDir: path.resolve(process.env.DATA_DIR ?? './storage'),
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
};

/** True when requests go to a local stand-in (scripts/mock-meta.ts), not Meta. */
export function isSimulatedAPI(): boolean {
  const host = new URL(config.metaBaseURL).hostname;
  return host === 'localhost' || host === '127.0.0.1';
}
