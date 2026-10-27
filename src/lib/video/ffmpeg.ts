import { spawn } from 'node:child_process';
import { config } from '../config';

function run(bin: string, args: string[], timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`${bin} could not start (${e.message}). Is ffmpeg installed?`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} exited with ${code}: ${err.slice(-500)}`));
    });
  });
}

export interface VideoInfo {
  durationS: number;
  width: number;
  height: number;
}

export async function probe(file: string): Promise<VideoInfo> {
  const out = await run(config.ffprobePath, [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    file,
  ]);
  const data = JSON.parse(out) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
  };
  const video = data.streams?.find((s) => s.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('No video stream found');
  const durationS = Number(data.format?.duration ?? video.duration);
  if (!Number.isFinite(durationS)) throw new Error('Could not read the video duration');
  // Phones record portrait video as landscape + a rotation flag.
  const rotation = Math.abs(Number(video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0));
  const swap = rotation === 90 || rotation === 270;
  return {
    durationS,
    width: swap ? video.height : video.width,
    height: swap ? video.width : video.height,
  };
}

/**
 * Normalizes any phone clip to H.264 MP4 (what SAM's video path and browsers
 * both accept), at most 720p on the short side, rotation applied, audio
 * dropped — sound isn't scored and removing it keeps the files private.
 */
export async function transcode(input: string, output: string): Promise<void> {
  await run(config.ffmpegPath, [
    '-y', '-v', 'error',
    '-i', input,
    '-t', '16',
    '-an',
    '-vf', "scale='if(gt(iw,ih),-2,min(720,iw))':'if(gt(iw,ih),min(720,ih),-2)',fps=30",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    output,
  ]);
}

/** Writes frames sampled at `fps` as JPEGs named 0001.jpg, 0002.jpg, … */
export async function sampleFrames(input: string, outDir: string, fps: number): Promise<void> {
  await run(config.ffmpegPath, [
    '-y', '-v', 'error',
    '-i', input,
    '-vf', `fps=${fps}`,
    '-q:v', '3',
    `${outDir}/%04d.jpg`,
  ]);
}
