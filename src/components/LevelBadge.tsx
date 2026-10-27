import type { Confidence, Level } from '@/lib/types';

const LEVELS: Record<Level, { label: string; color: string; icon: string }> = {
  none: { label: 'No clear signs', color: 'var(--good)', icon: 'M5 10.5l3 3 7-7' },
  mild: { label: 'Mild signs', color: 'var(--warning)', icon: 'M10 5v6M10 14.5v.5' },
  elevated: { label: 'Raised signs', color: 'var(--critical)', icon: 'M10 4v7M10 14.5v.5' },
};

/** Status always carries an icon and a word, never colour alone. */
export function LevelBadge({ level, size = 'md' }: { level: Level; size?: 'sm' | 'md' }) {
  const l = LEVELS[level];
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${size === 'sm' ? 'text-xs' : 'text-sm'}`}>
      <span className="grid h-5 w-5 place-items-center rounded-full" style={{ background: l.color }}>
        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden fill="none" stroke={level === 'mild' ? '#0b0b0b' : '#fff'} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d={l.icon} />
        </svg>
      </span>
      {l.label}
    </span>
  );
}

export function ConfidenceTag({ confidence }: { confidence: Confidence }) {
  const bars = { low: 1, medium: 2, high: 3 }[confidence];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-2" title={`${confidence} confidence`}>
      <span className="flex items-end gap-0.5" aria-hidden>
        {[1, 2, 3].map((b) => (
          <span key={b} className="w-1 rounded-sm" style={{ height: 4 + b * 3, background: b <= bars ? 'var(--ink-2)' : 'var(--line)' }} />
        ))}
      </span>
      {confidence[0].toUpperCase() + confidence.slice(1)} confidence
    </span>
  );
}
