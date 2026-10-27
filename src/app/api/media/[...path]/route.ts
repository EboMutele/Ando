import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import * as storage from '@/lib/storage';

export const runtime = 'nodejs';

const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
};

const body = (file: string, opts?: { start: number; end: number }) =>
  Readable.toWeb(fs.createReadStream(file, opts)) as ReadableStream;

/** Serves stored media, with Range support (iOS Safari will not play video without it). */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  let file: string;
  try {
    file = storage.resolveKey(parts.map(decodeURIComponent).join('/'));
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const type = TYPES[path.extname(file)];
  if (!type || !fs.existsSync(file)) return new Response('Not found', { status: 404 });

  const size = fs.statSync(file).size;
  const headers = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (!range || (!range[1] && !range[2])) {
    return new Response(body(file), { headers: { ...headers, 'content-length': String(size) } });
  }
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  }
  return new Response(body(file, { start, end }), {
    status: 206,
    headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) },
  });
}
