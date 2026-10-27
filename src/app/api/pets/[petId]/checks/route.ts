import { NextResponse } from 'next/server';
import path from 'node:path';
import { isSimulatedAPI } from '@/lib/config';
import * as repo from '@/lib/db/repo';
import { ingest, runAnalysis, UnusableClipError } from '@/lib/pipeline';

export const runtime = 'nodejs';

const MAX_BYTES = 150 * 1024 * 1024;
const EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.3gp', '.mkv']);

/**
 * Accepts the clip and validates/normalizes it within the request, so a bad
 * clip is rejected immediately; analysis then runs in the background and the
 * client polls GET /api/checks/:id.
 */
export async function POST(request: Request, { params }: { params: Promise<{ petId: string }> }) {
  const { petId } = await params;
  const pet = repo.getPet(petId);
  if (!pet) return NextResponse.json({ error: 'Pet not found' }, { status: 404 });

  const form = await request.formData();
  const video = form.get('video');
  if (!(video instanceof File) || video.size === 0) {
    return NextResponse.json({ error: 'Choose a video to upload' }, { status: 400 });
  }
  if (video.size > MAX_BYTES) return NextResponse.json({ error: 'Videos must be under 150 MB' }, { status: 413 });
  const ext = path.extname(video.name).toLowerCase();
  if (!video.type.startsWith('video/') && !EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: 'That file is not a video' }, { status: 415 });
  }

  const checkId = repo.createCheck({ petId: pet.id, simulated: isSimulatedAPI() });
  try {
    const info = await ingest(checkId, Buffer.from(await video.arrayBuffer()), EXTENSIONS.has(ext) ? ext : '.mp4');
    void runAnalysis(checkId, pet, info);
    return NextResponse.json({ checkId }, { status: 202 });
  } catch (e) {
    if (!(e instanceof UnusableClipError)) console.error('[ando] ingest failed', e);
    const message = e instanceof UnusableClipError ? e.message : "That video couldn't be read. Try recording it again.";
    repo.setCheckStage(checkId, 'ingest', 'unusable', message);
    return NextResponse.json({ error: message, checkId }, { status: 422 });
  }
}
