import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { formatAge } from '../present';
import { scaleFor } from '../scoring/scales';
import * as storage from '../storage';
import type { Trend } from '../trend';
import type { Alert, Check, Feature, Pet } from '../types';
import { DISCLAIMER } from '../types';

const INK = '#1b1b1a';
const MUTED = '#6b6a66';
const LINE = '#dedcd5';
const SERIES = '#2a78d6';
const CRITICAL = '#d03b3b';
const LEVEL_TEXT = { none: 'No clear signs', mild: 'Mild signs', elevated: 'Raised signs' } as const;

/** Trend chart as PNG, drawn as SVG with the same encoding as the in-app chart. */
export async function trendChartPng(trend: Trend, width = 1000, height = 300): Promise<Buffer | null> {
  const days = trend.days.slice(-21);
  if (days.length === 0) return null;
  const pad = { l: 44, r: 16, t: 16, b: 36 };
  const t0 = Date.parse(`${days[0].day}T00:00:00Z`);
  const span = Math.max(1, Date.parse(`${days.at(-1)!.day}T00:00:00Z`) - t0);
  const x = (d: string) => pad.l + (days.length === 1 ? (width - pad.l - pad.r) / 2 : ((Date.parse(`${d}T00:00:00Z`) - t0) / span) * (width - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - Math.min(1, v)) * (height - pad.t - pad.b);
  const grid = [0, 0.2, 0.4, 0.6, 0.8, 1]
    .map((t) => `<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="${LINE}"/><text x="${pad.l - 8}" y="${y(t) + 5}" text-anchor="end" font-size="15" fill="${MUTED}">${t * 10}</text>`)
    .join('');
  const path = days.map((d, i) => `${i ? 'L' : 'M'}${x(d.day)},${y(d.score)}`).join('');
  const dots = days.map((d) => `<circle cx="${x(d.day)}" cy="${y(d.score)}" r="7" fill="${d.raised ? CRITICAL : SERIES}" stroke="#fff" stroke-width="3"/>`).join('');
  const every = Math.ceil(days.length / 7);
  const labels = days
    .map((d, i) => (i % every === 0 || i === days.length - 1 ? `<text x="${x(d.day)}" y="${height - 10}" text-anchor="${i === days.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}" font-size="15" fill="${MUTED}">${d.day.slice(5)}</text>` : ''))
    .join('');
  const band = trend.baseline === null ? '' : `<rect x="${pad.l}" width="${width - pad.l - pad.r}" y="${y(trend.baseline + 0.05)}" height="${y(Math.max(0, trend.baseline - 0.05)) - y(trend.baseline + 0.05)}" fill="${MUTED}" opacity="0.15"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Helvetica, Arial, sans-serif">
    <rect width="100%" height="100%" fill="#fff"/>${grid}${band}
    <line x1="${pad.l}" x2="${width - pad.r}" y1="${y(trend.threshold)}" y2="${y(trend.threshold)}" stroke="${CRITICAL}" stroke-width="2" stroke-dasharray="8 6"/>
    <text x="${pad.l + 6}" y="${y(trend.threshold) - 6}" font-size="15" fill="${MUTED}">cut-off</text>
    <path d="${path}" fill="none" stroke="${SERIES}" stroke-width="3" stroke-linejoin="round"/>${dots}${labels}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function readImage(key: string | null, w: number, h: number): Promise<Buffer | null> {
  if (!key) return null;
  try {
    return await sharp(await storage.get(key)).resize(w, h, { fit: 'contain', background: '#000' }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    return null;
  }
}

/** Mean score per feature over the first and last thirds of the window — what changed. */
export function featureShift(checks: Check[], features: Feature[]) {
  const scored = checks.filter((c) => c.status === 'done' && c.confidence !== 'low');
  const third = Math.max(1, Math.floor(scored.length / 3));
  const mean = (cs: Check[], f: Feature) => {
    const v = cs.map((c) => c.features.find((x) => x.feature === f)?.score).filter((s): s is 0 | 1 | 2 => s !== null && s !== undefined);
    return v.length ? v.reduce<number>((a, b) => a + b, 0) / v.length : null;
  };
  return features.map((f) => ({ feature: f, before: mean(scored.slice(0, third), f), recent: mean(scored.slice(-third), f) }));
}

export async function buildVetReport(pet: Pet, checks: Check[], trend: Trend, alerts: Alert[]): Promise<Buffer> {
  const scale = scaleFor(pet.species);
  const done = checks.filter((c) => c.status === 'done');
  const latest = done.at(-1) ?? null;
  const doc = new PDFDocument({ size: 'A4', margin: 36, info: { Title: `Ando report — ${pet.name}`, Author: 'Ando' } });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const finished = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = 36;
  const width = doc.page.width - 72;

  // Header
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(`Pain-signal report: ${pet.name}`, left, 36);
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
    .text(`${pet.species === 'cat' ? 'Cat' : 'Dog'}, ${formatAge(pet.ageMonths)} · ${done.length} scored checks${done.length ? ` from ${done[0].recordedAt.slice(0, 10)} to ${latest!.recordedAt.slice(0, 10)}` : ''} · generated ${new Date().toISOString().slice(0, 10)} by Ando`);
  doc.moveDown(0.3).fillColor(CRITICAL).font('Helvetica-Bold').fontSize(9.5).text(DISCLAIMER + ' Owner-recorded phone videos, scored by AI; for discussion with a veterinarian.');

  // Summary line
  doc.moveDown(0.6).fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Summary');
  doc.font('Helvetica').fontSize(9.5);
  const summary = [
    latest ? `Latest (${latest.recordedAt.slice(0, 10)}): ${latest.rawScore}/${latest.rawMax} on the ${scale.name} — ${LEVEL_TEXT[latest.level!]}, ${latest.confidence} confidence.` : 'No scored checks yet.',
    `Cut-off used: ${(scale.elevatedAt * 10).toFixed(1)}/10 (normalized). Pet's own baseline: ${trend.baseline === null ? 'not yet established' : `${(trend.baseline * 10).toFixed(1)}/10`}.`,
    trend.slopePerDay !== null ? `14-day trend: ${trend.slopePerDay >= 0 ? '+' : ''}${(trend.slopePerDay * 10).toFixed(2)} points/day.` : '',
    ...alerts.map((a) => `ALERT (${a.kind}, since ${a.firstDay}): ${a.message}`),
  ].filter(Boolean);
  for (const line of summary) doc.text(line, { width });

  // Trend chart
  const chart = await trendChartPng(trend);
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(11).text('Daily score (0–10), last 21 days');
  if (chart) doc.image(chart, left, doc.y + 4, { width, height: width * 0.3 });
  doc.y += width * 0.3 + 10;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Blue: daily mean of medium/high-confidence checks. Red: raised day (≥ cut-off or ≥ baseline + 2). Dashed: cut-off. Grey band: baseline.', left);

  // Feature change table
  const shift = featureShift(done, scale.features.map((f) => f.feature));
  doc.moveDown(0.6).fillColor(INK).font('Helvetica-Bold').fontSize(11).text('What changed (mean item score, 0–2)', left);
  const colX = [left, left + 230, left + 320, left + 410];
  let ty = doc.y + 4;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
  ['Item', 'Earlier', 'Recent', 'Change'].forEach((h, i) => doc.text(h, colX[i], ty));
  ty += 13;
  doc.font('Helvetica').fillColor(INK);
  for (const s of shift) {
    const rubric = scale.features.find((f) => f.feature === s.feature)!;
    const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(1));
    const delta = s.before !== null && s.recent !== null ? s.recent - s.before : null;
    doc.fillColor(INK).text(rubric.label, colX[0], ty);
    doc.text(fmt(s.before), colX[1], ty);
    doc.text(fmt(s.recent), colX[2], ty);
    doc.fillColor(delta !== null && delta >= 0.5 ? CRITICAL : INK).text(delta === null ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`, colX[3], ty);
    ty += 12;
  }
  doc.y = ty + 4;

  // Key frames of the latest check
  if (latest && latest.keyFrames.length) {
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(11).text(`Key frames, latest check (${latest.recordedAt.slice(0, 10)})`, left);
    const n = Math.min(4, latest.keyFrames.length);
    const gap = 8;
    const w = (width - gap * (n - 1)) / n;
    const h = w * 0.75;
    const top = doc.y + 4;
    for (let i = 0; i < n; i++) {
      const k = latest.keyFrames[i];
      const img = (await readImage(k.overlayPath, 480, 360)) ?? (await readImage(k.framePath, 480, 360));
      if (img) doc.image(img, left + i * (w + gap), top, { width: w, height: h });
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(`Frame ${k.idx} · ${k.tS}s`, left + i * (w + gap), top + h + 2, { width: w });
    }
    doc.y = top + h + 14;
    if (latest.note) doc.font('Helvetica-Oblique').fontSize(9).fillColor(INK).text(`AI note: ${latest.note}`, left, doc.y, { width });
  }

  // Recent checks
  doc.moveDown(0.5).fillColor(INK).font('Helvetica-Bold').fontSize(11).text('Recent checks', left);
  doc.font('Helvetica').fontSize(8.5);
  const rows = done.slice(-8).reverse();
  for (const c of rows) {
    const top = c.features.filter((f) => f.inTotal && (f.score ?? 0) >= 1).map((f) => `${f.feature} ${f.score}`).join(', ');
    doc.fillColor(INK).text(`${c.recordedAt.slice(0, 10)}  ${String(c.rawScore).padStart(2)}/${c.rawMax}  ${LEVEL_TEXT[c.level!]}, ${c.confidence} conf.${top ? `  (${top})` : ''}`, left, doc.y, { width });
  }

  // Footer
  const models = latest?.models ? Object.entries(latest.models).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
  // Write inside the bottom margin without triggering a page break: one page, always.
  doc.page.margins.bottom = 0;
  doc.fontSize(7).fillColor(MUTED).text(
    `Method: key frames segmented with SAM 3.1; items rated by Muse Spark against ${scale.name}; totals computed as sum of scored items ÷ maximum possible. ${scale.citation}${models ? ` Models: ${models}.` : ''}`,
    left,
    doc.page.height - 50,
    { width, lineBreak: true },
  );

  doc.end();
  return finished;
}
