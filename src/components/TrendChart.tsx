'use client';

import { useMemo, useState } from 'react';
import type { DayPoint } from '@/lib/trend';

const W = 360;
const H = 200;
const PAD = { top: 16, right: 12, bottom: 28, left: 28 };

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * Daily pain-signal score on a 0–10 scale (normalized score × 10), with the
 * species cut-off as a reference line and the pet's own baseline as a band.
 * One series → no legend; the title names it.
 */
export function TrendChart({ days, threshold, baseline }: { days: DayPoint[]; threshold: number; baseline: number | null }) {
  const [active, setActive] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (days.length === 0) return null;
    const t0 = Date.parse(`${days[0].day}T00:00:00Z`);
    const t1 = Date.parse(`${days.at(-1)!.day}T00:00:00Z`);
    const span = Math.max(1, t1 - t0);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const x = (d: string) => PAD.left + (days.length === 1 ? innerW / 2 : ((Date.parse(`${d}T00:00:00Z`) - t0) / span) * innerW);
    const y = (v: number) => PAD.top + innerH - Math.min(1, v) * innerH;
    return { x, y, innerW };
  }, [days]);

  if (!geo) return <p className="text-sm text-ink-3">No scored checks yet.</p>;
  const { x, y } = geo;
  const pts = days.map((d) => ({ ...d, cx: x(d.day), cy: y(d.score) }));
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join('');
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const labelEvery = Math.ceil(days.length / 5);
  const a = active === null ? null : pts[active];

  return (
    <figure className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Daily pain-signal score over ${days.length} days. Latest ${(days.at(-1)!.score * 10).toFixed(1)} of 10.`}
        onPointerLeave={() => setActive(null)}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          pts.forEach((p, i) => Math.abs(p.cx - px) < Math.abs(pts[best].cx - px) && (best = i));
          setActive(best);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--line)'} strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-3)">
              {t * 10}
            </text>
          </g>
        ))}

        {baseline !== null && (
          <rect x={PAD.left} width={W - PAD.left - PAD.right} y={y(baseline + 0.05)} height={Math.max(2, y(Math.max(0, baseline - 0.05)) - y(baseline + 0.05))} fill="var(--ink-3)" opacity={0.12} />
        )}

        <line x1={PAD.left} x2={W - PAD.right} y1={y(threshold)} y2={y(threshold)} stroke="var(--critical)" strokeWidth={1.5} strokeDasharray="4 3" />
        <text x={PAD.left + 4} y={y(threshold) - 4} fontSize="10" fill="var(--ink-2)">
          Vet-scale cut-off
        </text>

        <path d={path} fill="none" stroke="var(--series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {a && <line x1={a.cx} x2={a.cx} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--axis)" strokeWidth={1} />}

        {pts.map((p, i) => (
          <g key={p.day}>
            {/* 2px surface ring keeps overlapping markers legible */}
            <circle cx={p.cx} cy={p.cy} r={i === active ? 6 : 4.5} fill={p.raised ? 'var(--critical)' : 'var(--series)'} stroke="var(--surface)" strokeWidth={2} />
            {p.raised && (
              <text x={p.cx} y={p.cy - 9} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--critical)" aria-hidden>
                !
              </text>
            )}
            {i % labelEvery === 0 || i === pts.length - 1 ? (
              <text x={p.cx} y={H - 10} textAnchor={i === pts.length - 1 && pts.length > 1 ? 'end' : i === 0 && pts.length > 1 ? 'start' : 'middle'} fontSize="10" fill="var(--ink-3)">
                {fmtDay(p.day)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>

      {a && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-sm"
          style={{ left: `clamp(0px, calc(${(a.cx / W) * 100}% - 60px), calc(100% - 130px))`, width: 130 }}
        >
          <div className="font-semibold text-ink">{fmtDay(a.day)}</div>
          <div className="text-ink-2">
            Score {(a.score * 10).toFixed(1)} / 10{a.checks > 1 ? ` · ${a.checks} checks` : ''}
          </div>
          {a.raised && <div className="font-semibold text-ink">! Raised day</div>}
        </div>
      )}

      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--critical)' }} /> cut-off
        </span>
        {baseline !== null && (
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-4 rounded-sm bg-ink-3/20" /> usual for this pet
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: 'var(--critical)' }} /> ! raised day
        </span>
      </figcaption>
    </figure>
  );
}
