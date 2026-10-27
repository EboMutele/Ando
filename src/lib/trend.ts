import type { Confidence, Species } from './types';
import { scaleFor } from './scoring/scales';

export interface TrendInput {
  recordedAt: string;
  score: number | null;
  confidence: Confidence | null;
}

export interface DayPoint {
  day: string; // YYYY-MM-DD in the owner's time zone
  score: number; // mean of qualifying checks that day
  checks: number;
  raised: boolean;
}

export interface TrendAlert {
  kind: 'sustained' | 'rising';
  message: string;
  firstDay: string;
  lastDay: string;
}

export interface Trend {
  days: DayPoint[];
  baseline: number | null;
  threshold: number;
  /** Least-squares slope over the last 14 days, score units per day. */
  slopePerDay: number | null;
  alerts: TrendAlert[];
}

export const RULES = {
  baselineDays: 5,
  baselineMinDays: 3,
  baselineMargin: 0.2,
  windowDays: 5,
  raisedDaysForAlert: 3,
  slopeWindowDays: 14,
  slopeMinDays: 5,
  slopeAlertPerDay: 0.02,
} as const;

export function dayKey(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

export function computeTrend(species: Species, checks: TrendInput[], timeZone?: string): Trend {
  const threshold = scaleFor(species).elevatedAt;

  // Low-confidence checks are shown in history but never move the trend.
  const byDay = new Map<string, number[]>();
  for (const c of checks) {
    if (c.score === null || c.confidence === null || c.confidence === 'low') continue;
    const key = dayKey(c.recordedAt, timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), c.score]);
  }
  const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const means = sorted.map(([day, scores]) => ({
    day,
    score: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 1000) / 1000,
    checks: scores.length,
  }));

  const baselineSample = means.slice(0, RULES.baselineDays).map((d) => d.score);
  const baseline = baselineSample.length >= RULES.baselineMinDays ? median(baselineSample) : null;

  const days: DayPoint[] = means.map((d) => ({
    ...d,
    raised: d.score >= threshold || (baseline !== null && d.score >= baseline + RULES.baselineMargin),
  }));

  const alerts: TrendAlert[] = [];
  const recent = days.slice(-RULES.windowDays);
  const raised = recent.filter((d) => d.raised);
  const latest = days.at(-1);
  if (latest?.raised && raised.length >= RULES.raisedDaysForAlert) {
    alerts.push({
      kind: 'sustained',
      message: `Pain signals have been raised on ${raised.length} of the last ${recent.length} days with checks. Consider booking a vet visit.`,
      firstDay: raised[0].day,
      lastDay: latest.day,
    });
  }

  let slopePerDay: number | null = null;
  if (latest) {
    const from = dayNumber(latest.day) - (RULES.slopeWindowDays - 1);
    const window = days.filter((d) => dayNumber(d.day) >= from);
    if (window.length >= RULES.slopeMinDays) {
      const xs = window.map((d) => dayNumber(d.day));
      const ys = window.map((d) => d.score);
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
      const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
      slopePerDay = sxx === 0 ? 0 : Math.round((sxy / sxx) * 10_000) / 10_000;
      // The softer notice only matters when the stronger alert hasn't fired.
      if (slopePerDay >= RULES.slopeAlertPerDay && alerts.length === 0) {
        alerts.push({
          kind: 'rising',
          message: 'Scores have been creeping up over the last two weeks. Keep checking daily and watch for changes in appetite, sleep or movement.',
          firstDay: window[0].day,
          lastDay: latest.day,
        });
      }
    }
  }

  return { days, baseline, threshold, slopePerDay, alerts };
}
