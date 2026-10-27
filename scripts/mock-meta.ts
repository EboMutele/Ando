/**
 * Local stand-in for the parts of the Meta Model API Ando uses, for UI work
 * without a key and for contract tests. It speaks the documented wire
 * formats (SAM token text, Chat Completions JSON) but its "detections" are
 * fixed geometry and its "scores" are pseudo-random: checks made against it
 * are flagged as simulated everywhere in the app.
 *
 *   npm run mock-meta            # listens on :8787
 *   META_BASE_URL=http://127.0.0.1:8787/v1 MODEL_API_KEY=mock npm run dev
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

type Json = Record<string, unknown>;
export interface RecordedRequest {
  path: string;
  body: Json;
}

// The parser exports only a decoder; its internal encoder lets the mock emit
// valid one_bit payloads (it is what Meta uses to build conformance data).
const require = createRequire(import.meta.url);
const codecUrl = pathToFileURL(path.join(path.dirname(require.resolve('@meta-sam/parser')), 'mask-codec.js')).href;
const { encodeSegmentationMask } = (await import(codecUrl)) as {
  encodeSegmentationMask: (r: Uint8Array, w: number, h: number) => { payload: string };
};

function ellipseMask(w: number, h: number): string {
  const raster = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const dx = (x + 0.5 - w / 2) / (w / 2);
      const dy = (y + 0.5 - h / 2) / (h / 2);
      raster[y * w + x] = dx * dx + dy * dy <= 1 ? 1 : 0;
    }
  return encodeSegmentationMask(raster, w, h).payload;
}

async function samOutput(phrase: string, imageUrl: string): Promise<string> {
  const bytes = Buffer.from(imageUrl.split(',')[1] ?? '', 'base64');
  const { width = 640, height = 360 } = await sharp(bytes).metadata();
  const isFace = /face/.test(phrase);
  const f = isFace ? [0.38, 0.18, 0.62, 0.5] : [0.15, 0.15, 0.85, 0.92];
  const x1 = Math.floor(f[0] * width);
  const y1 = Math.floor(f[1] * height);
  const x2 = Math.floor(f[2] * width) - 1;
  const y2 = Math.floor(f[3] * height) - 1;
  const w = x2 - x1 + 1;
  const h = y2 - y1 + 1;
  const c = isFace ? 0.91 : 0.96;
  return `<0f>0<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=${width};h=${height};c=${c}|><|mask;x=0;y=0;c=${c};data=${h},${w},${ellipseMask(w, h)}|>\n`;
}

function assessment(body: Json): Json {
  const schema = (body.response_format as { json_schema?: { schema?: { properties?: { features?: { required?: string[] } } } } })
    ?.json_schema?.schema;
  const features = schema?.properties?.features?.required ?? ['ears', 'eyes', 'muzzle', 'whiskers', 'head', 'posture', 'gait'];
  const seed = createHash('sha256').update(JSON.stringify(body.messages)).digest();
  const out: Json = {};
  features.forEach((f, i) => {
    const r = seed[i] % 10;
    out[f] = {
      score: f === 'gait' ? null : r < 6 ? 0 : r < 9 ? 1 : 2,
      confidence: 'medium',
      evidence: `Simulated rating for ${f} (frames 1–3).`,
      frames: [1, 2, 3],
    };
  });
  return {
    usable: true,
    exclusion: null,
    pet_moving: false,
    features: out,
    overall_confidence: 'medium',
    quality_issues: [],
    note: 'This is a simulated result from the local mock API, not a real assessment.',
  };
}

export function startMockMeta(port = 8787): Promise<{ url: string; requests: RecordedRequest[]; close: () => Promise<void> }> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const send = (status: number, payload: Json) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      return send(401, { error: { message: 'missing key' } });
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const isJson = (req.headers['content-type'] ?? '').includes('json');
    const body = raw.length && isJson ? (JSON.parse(raw.toString()) as Json) : { multipart: raw.toString('latin1').match(/name="(\w+)"/g) ?? [] };
    const url = req.url ?? '';
    requests.push({ path: url, body });

    if (req.method === 'GET' && url.endsWith('/models')) {
      return send(200, { object: 'list', data: ['muse-spark-1.3', 'sam-3.1', 'muse-image-1.0'].map((id) => ({ id, object: 'model' })) });
    }
    if (req.method === 'POST' && url.endsWith('/responses')) {
      const content = (body.input as { content: { type: string; text?: string; image_url?: string }[] }[])[0].content;
      const phrase = content.find((p) => p.type === 'input_text')?.text ?? '';
      const image = content.find((p) => p.type === 'input_image')?.image_url ?? '';
      const text = await samOutput(phrase, image);
      return send(200, {
        id: `resp_${requests.length}`,
        object: 'response',
        status: 'completed',
        model: body.model,
        output: [{ id: `msg_${requests.length}`, type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }],
      });
    }
    if (req.method === 'POST' && url.endsWith('/chat/completions')) {
      return send(200, {
        id: `chatcmpl_${requests.length}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(assessment(body)) } }],
      });
    }
    if (req.method === 'POST' && /\/images\/(generations|edits)$/.test(url)) {
      const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#cfe3d8' } }).png().toBuffer();
      return send(200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: png.toString('base64') }] });
    }
    send(404, { error: { message: `mock-meta: ${req.method} ${url} not implemented` } });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${address.port}/v1`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { url } = await startMockMeta(Number(process.env.PORT ?? 8787));
  console.log(`mock Meta Model API on ${url} — results are simulated`);
}
