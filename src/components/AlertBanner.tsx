'use client';

import { useRouter } from 'next/navigation';
import type { Alert } from '@/lib/types';

export function AlertBanner({ alert, petId, petName }: { alert: Alert; petId: string; petName: string }) {
  const router = useRouter();
  const sustained = alert.kind === 'sustained';
  return (
    <section
      role="alert"
      className="rounded-2xl border-2 p-4"
      style={{ borderColor: sustained ? 'var(--critical)' : 'var(--warning)', background: 'var(--surface)' }}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg font-bold"
          style={{ background: sustained ? 'var(--critical)' : 'var(--warning)', color: sustained ? '#fff' : '#0b0b0b' }}
          aria-hidden
        >
          !
        </span>
        <div className="space-y-1">
          <h2 className="font-semibold">{sustained ? `${petName}'s scores have stayed raised` : `${petName}'s scores are creeping up`}</h2>
          <p className="text-sm text-ink-2">{alert.message}</p>
          <p className="text-xs text-ink-3">Since {new Date(`${alert.firstDay}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}. The vet report summarises the trend for your appointment.</p>
          <div className="flex gap-3 pt-1">
            <a href={`/api/pets/${petId}/report`} className="text-sm font-semibold text-brand underline">
              Vet report
            </a>
            <button
              className="text-sm text-ink-2 underline"
              onClick={async () => {
                await fetch(`/api/pets/${petId}/alerts/${alert.id}`, { method: 'DELETE' });
                router.refresh();
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
