import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
  type SegmentationMask,
} from '@meta-sam/parser';
import sharp from 'sharp';
import { config } from '../config';
import type { Box, Species } from '../types';
import { dataUrl, meta } from './client';

/**
 * SAM 3.1 on the Meta Model API is served through the Responses endpoint.
 * Request shape follows Meta's reference client (github.com/meta-models/meta-sam,
 * typescript/examples/api-playground/server/openai-request.ts):
 *   - images are unary (stream: false) and sent inline as a data URL;
 *   - the prompt is a short noun phrase, one concept per request;
 *   - options travel as string-valued Responses metadata.
 * The output is SAM's token text (one line per frame), decoded by Meta's
 * @meta-sam/parser.
 */

export interface Detection {
  objectId: string;
  box: Box;
  confidence: number | null;
  mask: SegmentationMask;
}

export function samConcepts(species: Species): { face: string; body: string } {
  return { face: `${species} face`, body: species };
}

export function buildSamImageRequest(model: string, phrase: string, image: Buffer) {
  const text = phrase.trim();
  if (!text) throw new TypeError('The SAM prompt must be a noun phrase.');
  return {
    model,
    stream: false as const,
    input: [
      {
        type: 'message' as const,
        role: 'user' as const,
        content: [
          { type: 'input_text' as const, text },
          { type: 'input_image' as const, image_url: dataUrl(image) },
        ],
      },
    ],
    metadata: { include_confidence: 'true' },
  };
}

interface UnaryResponse {
  id?: string;
  status?: string;
  output?: { id?: string; type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[];
  incomplete_details?: unknown;
  error?: { message: string } | null;
}

/** Adapts a unary Responses body into the event stream the parser consumes (as Meta's playground does). */
export function unaryToEvents(body: UnaryResponse): ResponsesEvent[] {
  const events: ResponsesEvent[] = [];
  let contentIndex = 0;
  (body.output ?? []).forEach((item, outputIndex) => {
    const itemId = item.id || 'sam-image';
    for (const part of item.content ?? []) {
      const lane = { item_id: itemId, output_index: outputIndex, content_index: contentIndex };
      if (part.type === 'output_text' && typeof part.text === 'string') {
        events.push({ type: 'response.output_text.delta', delta: part.text, ...lane });
        events.push({ type: 'response.output_text.done', text: part.text, ...lane });
        contentIndex++;
      } else if (part.type === 'refusal' && typeof part.refusal === 'string') {
        events.push({ type: 'response.refusal.delta', delta: part.refusal, ...lane });
        events.push({ type: 'response.refusal.done', refusal: part.refusal, ...lane });
        contentIndex++;
      }
    }
  });
  if (body.status === 'completed') events.push({ type: 'response.completed' });
  else if (body.status === 'incomplete')
    events.push({ type: 'response.incomplete', response: { incomplete_details: body.incomplete_details ?? null } });
  else events.push({ type: 'response.failed', response: { error: body.error ?? null } });
  return events;
}

export async function parseDetections(events: ResponsesEvent[]): Promise<Detection[]> {
  async function* source() {
    yield* events;
  }
  const result = await parseImageStream(source()).finalResult;
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    // Dropped records would read as "pet not found"; log so it is visible.
    console.warn(`[ando] SAM output had ${errors.length} malformed line(s): ${errors[0].code} ${errors[0].message}`);
  }
  const boxes = recordsOfKind(result.records, 'box');
  return recordsOfKind(result.records, 'mask').map((m) => {
    const box = boxes.find((b) => b.objectId === m.objectId);
    return {
      objectId: m.objectId,
      box: { left: m.bounds.left, top: m.bounds.top, right: m.bounds.right, bottom: m.bounds.bottom },
      confidence: m.confidence ?? box?.confidence ?? null,
      mask: m.mask,
    };
  });
}

export async function segmentImage(image: Buffer, phrase: string): Promise<Detection[]> {
  const request = buildSamImageRequest(config.samModel, phrase, image);
  // The SDK's input_image type insists on `detail`; Meta's SAM requests omit it.
  const body = (await meta().responses.create(request as never)) as unknown as UnaryResponse;
  return parseDetections(unaryToEvents(body));
}

const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);

export function intersection(a: Box, b: Box): number {
  return area({
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  });
}

/**
 * Chooses the pet being checked when SAM finds several animals: the most
 * confident body (ties → largest), then the face that lies inside it.
 */
export function choosePet(bodies: Detection[], faces: Detection[]): { body: Detection | null; face: Detection | null } {
  const rank = (d: Detection) => (d.confidence ?? 0.5) * 1e9 + area(d.box);
  const body = [...bodies].sort((a, b) => rank(b) - rank(a))[0] ?? null;
  const candidates = body ? faces.filter((f) => intersection(f.box, body.box) / Math.max(1, area(f.box)) > 0.6) : faces;
  const face = [...candidates].sort((a, b) => rank(b) - rank(a))[0] ?? null;
  return { body, face };
}

/** Face close-up with margin, so Spark sees ears and whiskers at full resolution. */
export async function cropFace(frame: Buffer, face: Box, size = 448): Promise<Buffer> {
  const meta = await sharp(frame).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const w = face.right - face.left;
  const h = face.bottom - face.top;
  const side = Math.max(w, h) * 1.35;
  const cx = face.left + w / 2;
  const cy = face.top + h / 2;
  const left = Math.max(0, Math.round(cx - side / 2));
  const top = Math.max(0, Math.round(cy - side / 2));
  const width = Math.max(1, Math.min(W - left, Math.round(side)));
  const height = Math.max(1, Math.min(H - top, Math.round(side)));
  return sharp(frame)
    .extract({ left, top, width, height })
    .resize(size, size, { fit: 'contain', background: '#000' })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** Tinted mask layer for one detection, positioned at its box. */
async function maskLayer(d: Detection, rgb: [number, number, number], alpha: number) {
  const raster = decodeMaskToRaster(d.mask);
  const { width, height } = d.mask;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < raster.length; i++) {
    if (!raster[i]) continue;
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = alpha;
  }
  const bw = Math.max(1, d.box.right - d.box.left);
  const bh = Math.max(1, d.box.bottom - d.box.top);
  const input = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .resize(bw, bh, { fit: 'fill', kernel: 'nearest' })
    .png()
    .toBuffer();
  return { input, left: d.box.left, top: d.box.top };
}

/** Key frame with SAM's body (teal) and face (amber) masks drawn on top. */
export async function renderOverlay(frame: Buffer, body: Detection | null, face: Detection | null): Promise<Buffer> {
  const layers = [];
  if (body) layers.push(await maskLayer(body, [20, 184, 166], 90));
  if (face) layers.push(await maskLayer(face, [245, 158, 11], 120));
  return sharp(frame).composite(layers).jpeg({ quality: 85 }).toBuffer();
}
