import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import fixture from './fixtures/sam-captured-image.json';
import {
  buildSamImageRequest,
  choosePet,
  cropFace,
  parseDetections,
  renderOverlay,
  unaryToEvents,
  type Detection,
} from '@/lib/meta/sam';

const unary = (text: string, status = 'completed') => ({
  id: 'resp_1',
  status,
  output: [{ id: 'msg_1', type: 'message', content: [{ type: 'output_text', text }] }],
});

describe('SAM 3.1 request', () => {
  it('matches the shape of Meta\'s reference client', () => {
    const req = buildSamImageRequest('sam-3.1', '  cat face ', Buffer.from([1, 2, 3]));
    expect(req).toEqual({
      model: 'sam-3.1',
      stream: false,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'cat face' },
            { type: 'input_image', image_url: 'data:image/jpeg;base64,AQID' },
          ],
        },
      ],
      metadata: { include_confidence: 'true' },
    });
  });

  it('rejects an empty concept', () => {
    expect(() => buildSamImageRequest('sam-3.1', ' ', Buffer.alloc(1))).toThrow();
  });
});

describe('SAM 3.1 output', () => {
  it('decodes a captured live API response', async () => {
    const detections = await parseDetections(unaryToEvents(unary(fixture.output_text)));
    expect(detections).toHaveLength(1);
    expect(detections[0].objectId).toBe('0');
    expect(detections[0].box).toEqual({ left: 513, top: 371, right: 524, bottom: 382 });
    expect(detections[0].mask).toMatchObject({ encoding: 'lossless', width: 11, height: 11 });
    expect(detections[0].confidence).toBeNull();
  });

  it('treats an empty lane as zero matches, not an error', async () => {
    expect(await parseDetections(unaryToEvents(unary('')))).toEqual([]);
  });

  it('reads confidence and multiple objects', async () => {
    const text =
      '<0f>0<|box;x1=0;y1=0;x2=4;y2=4;w=20;h=10;c=0.4|><|mask;x=0;y=0;c=0.4;data=5,5,!!!!!(QO(0lu8?|>' +
      ',3<|box;x1=10;y1=2;x2=14;y2=6;w=20;h=10;c=0.9|><|mask;x=0;y=0;c=0.9;data=5,5,!!!!!(QO(0lu8?|>\n';
    const d = await parseDetections(unaryToEvents(unary(text)));
    expect(d.map((x) => [x.objectId, x.confidence])).toEqual([
      ['0', 0.4],
      ['3', 0.9],
    ]);
  });

  it('surfaces a failed response', async () => {
    await expect(parseDetections(unaryToEvents({ status: 'failed', error: { message: 'x' } } as never))).rejects.toThrow();
  });
});

describe('pet selection and rendering', () => {
  const det = (id: string, box: Detection['box'], confidence: number | null): Detection => ({
    objectId: id,
    box,
    confidence,
    mask: { encoding: 'one_bit', width: 5, height: 5, payload: '!!!!!(QO(0lu8?' },
  });

  it('picks the most confident body and the face inside it', () => {
    const bodies = [det('0', { left: 0, top: 0, right: 100, bottom: 100 }, 0.5), det('1', { left: 200, top: 0, right: 400, bottom: 200 }, 0.9)];
    const faces = [det('5', { left: 10, top: 10, right: 40, bottom: 40 }, 0.95), det('6', { left: 250, top: 20, right: 300, bottom: 70 }, 0.7)];
    const { body, face } = choosePet(bodies, faces);
    expect(body?.objectId).toBe('1');
    expect(face?.objectId).toBe('6');
  });

  it('crops faces and draws overlays on a real image', async () => {
    const frame = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#888' } }).jpeg().toBuffer();
    const face = det('0', { left: 600, top: 300, right: 640, bottom: 360 }, 0.9);
    const crop = await sharp(await cropFace(frame, face.box)).metadata();
    expect([crop.width, crop.height]).toEqual([448, 448]);
    const overlay = await sharp(await renderOverlay(frame, det('1', { left: 0, top: 0, right: 320, bottom: 360 }, 0.8), face)).metadata();
    expect([overlay.width, overlay.height]).toEqual([640, 360]);
  });
});
