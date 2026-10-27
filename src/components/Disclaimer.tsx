import { DISCLAIMER } from '@/lib/types';

export function Disclaimer({ className = '' }: { className?: string }) {
  return (
    <p role="note" className={`flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2 ${className}`}>
      <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden fill="currentColor">
        <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm0 4a1 1 0 011 1v4a1 1 0 11-2 0V7a1 1 0 011-1zm0 8.5a1.2 1.2 0 110-2.4 1.2 1.2 0 010 2.4z" />
      </svg>
      <span>{DISCLAIMER}</span>
    </p>
  );
}
