import sharp from 'sharp';
import { generateCardIllustration } from '../meta/museImage';
import * as storage from '../storage';
import type { Trend } from '../trend';
import type { Check, Level, Pet } from '../types';
import { DISCLAIMER } from '../types';

const W = 1080;
const H = 1350; // 4:5, the shape messaging apps and Instagram show uncropped
const LEVEL = {
  none: { text: 'No clear signs', color: '#0ca30c' },
  mild: { text: 'Mild signs', color: '#fab219' },
  elevated: { text: 'Raised signs', color: '#d03b3b' },
} as const;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Data layer of the card: always rendered by Ando, never by an image model. */
export function cardSvg(pet: Pet, trend: Trend, latest: Check | null, headline: string): string {
  const days = trend.days.slice(-14);
  const cx = 80;
  const cw = W - 160;
  const cy = 860;
  const ch = 260;
  const t0 = days.length ? Date.parse(`${days[0].day}T00:00:00Z`) : 0;
  const span = days.length > 1 ? Date.parse(`${days.at(-1)!.day}T00:00:00Z`) - t0 : 1;
  const x = (d: string) => cx + (days.length === 1 ? cw / 2 : ((Date.parse(`${d}T00:00:00Z`) - t0) / span) * cw);
  const y = (v: number) => cy + ch - Math.min(1, v) * ch;
  const line = days.map((d, i) => `${i ? 'L' : 'M'}${x(d.day)},${y(d.score)}`).join('');
  const dots = days.map((d) => `<circle cx="${x(d.day)}" cy="${y(d.score)}" r="11" fill="${d.raised ? '#d03b3b' : '#2a78d6'}" stroke="#fffdf8" stroke-width="4"/>`).join('');
  const level = latest?.level ? LEVEL[latest.level] : null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Helvetica, Arial, sans-serif">
    <rect x="0" y="720" width="${W}" height="${H - 720}" fill="#fffdf8"/>
    <text x="80" y="790" font-size="56" font-weight="700" fill="#1b1b1a">${esc(pet.name)}</text>
    ${level ? `<circle cx="${W - 310}" cy="772" r="16" fill="${level.color}"/><text x="${W - 282}" y="785" font-size="36" font-weight="700" fill="#1b1b1a">${level.text}</text>` : ''}
    <text x="80" y="835" font-size="30" fill="#52514e">${esc(headline)}</text>
    <line x1="${cx}" x2="${cx + cw}" y1="${y(trend.threshold)}" y2="${y(trend.threshold)}" stroke="#d03b3b" stroke-width="3" stroke-dasharray="12 9"/>
    <line x1="${cx}" x2="${cx + cw}" y1="${cy + ch}" y2="${cy + ch}" stroke="#c3c2b7" stroke-width="2"/>
    <path d="${line}" fill="none" stroke="#2a78d6" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/>${dots}
    <text x="${cx}" y="${cy + ch + 46}" font-size="26" fill="#7a7974">${days[0]?.day.slice(5) ?? ''}</text>
    <text x="${cx + cw}" y="${cy + ch + 46}" font-size="26" fill="#7a7974" text-anchor="end">${days.at(-1)?.day.slice(5) ?? ''}</text>
    <text x="${W / 2}" y="${H - 50}" font-size="26" fill="#7a7974" text-anchor="middle">${esc(DISCLAIMER)} · Ando</text>
  </svg>`;
}

function headlineFor(trend: Trend, pet: Pet): string {
  if (trend.alerts.some((a) => a.kind === 'sustained')) return `Raised for several days — time to check in with a vet`;
  if (trend.alerts.some((a) => a.kind === 'rising')) return `Creeping up over the last two weeks`;
  return `${trend.days.length} days of checks · ${pet.species === 'cat' ? 'Feline Grimace Scale' : 'Glasgow CMPS-SF items'}`;
}

/**
 * Trend summary card as PNG. The top 720 px is the illustration: Muse Image
 * when enabled (cached per pet and level), otherwise the pet's own photo.
 */
export async function renderCard(pet: Pet, trend: Trend, latest: Check | null): Promise<Buffer> {
  const level: Level = latest?.level ?? 'none';
  const artKey = `pets/${pet.id}/card-art-${level}.png`;
  let art: Buffer | null = await storage.get(artKey).catch(() => null);
  const photo = pet.photoPath ? await storage.get(pet.photoPath).catch(() => null) : null;
  if (!art) {
    art = await generateCardIllustration(pet, level, photo).catch((e) => {
      console.warn('[ando] Muse Image failed; using the photo', e);
      return null;
    });
    if (art) await storage.put(artKey, art);
  }
  const top = art ?? photo;
  const base = sharp({ create: { width: W, height: H, channels: 3, background: '#efe6da' } });
  const layers: { input: Buffer; top: number; left: number }[] = [];
  if (top) layers.push({ input: await sharp(top).resize(W, 720, { fit: 'cover' }).png().toBuffer(), top: 0, left: 0 });
  layers.push({ input: Buffer.from(cardSvg(pet, trend, latest, headlineFor(trend, pet))), top: 0, left: 0 });
  return base.composite(layers).png().toBuffer();
}
