import Link from 'next/link';
import { notFound } from 'next/navigation';
import * as repo from '@/lib/db/repo';
import { formatAge, presentPet } from '@/lib/present';
import { scaleFor } from '@/lib/scoring/scales';
import { computeTrend } from '@/lib/trend';
import { AlertBanner } from '@/components/AlertBanner';
import { Disclaimer } from '@/components/Disclaimer';
import { ConfidenceTag, LevelBadge } from '@/components/LevelBadge';
import { PetAvatar } from '@/components/PetAvatar';
import { TrendChart } from '@/components/TrendChart';

export const dynamic = 'force-dynamic';

export default async function PetPage({ params }: { params: Promise<{ petId: string }> }) {
  const { petId } = await params;
  const raw = repo.getPet(petId);
  if (!raw) notFound();
  const pet = presentPet(raw);
  const checks = repo.listChecks(pet.id);
  const done = checks.filter((c) => c.status === 'done');
  const trend = computeTrend(pet.species, done);
  const alerts = repo.openAlerts(pet.id);
  const scale = scaleFor(pet.species);

  return (
    <div className="space-y-5">
      <section className="flex items-center gap-4">
        <PetAvatar pet={pet} size={72} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{pet.name}</h1>
          <p className="text-ink-2">
            {pet.species === 'cat' ? 'Cat' : 'Dog'} · {formatAge(pet.ageMonths)}
          </p>
        </div>
      </section>

      {alerts.map((a) => (
        <AlertBanner key={a.id} alert={a} petId={pet.id} petName={pet.name} />
      ))}

      <Link href={`/pets/${pet.id}/check`} className="btn w-full text-lg">
        New check
      </Link>

      <section className="card space-y-2 p-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Pain-signal score, by day</h2>
          <span className="text-xs text-ink-3">0–10</span>
        </div>
        <TrendChart days={trend.days.slice(-21)} threshold={trend.threshold} baseline={trend.baseline} />
        <p className="text-xs text-ink-3">
          Based on the {scale.name}. Low-confidence checks are listed below but not plotted.
        </p>
      </section>

      {done.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <a href={`/api/pets/${pet.id}/report`} className="btn btn-ghost">
            Vet report (PDF)
          </a>
          <a href={`/api/pets/${pet.id}/card`} target="_blank" rel="noreferrer" className="btn btn-ghost">
            Summary card
          </a>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">History</h2>
        {checks.length === 0 && <p className="text-sm text-ink-3">No checks yet. Film a short clip to start.</p>}
        <ul className="card divide-y divide-line">
          {[...checks].reverse().map((c) => (
            <li key={c.id}>
              <Link href={`/checks/${c.id}`} className="flex items-center justify-between gap-3 p-3 active:opacity-80">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">
                    {new Date(c.recordedAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    {c.simulated && <span className="ml-2 text-xs text-ink-3">(simulated)</span>}
                  </div>
                  {c.status === 'done' && c.level ? (
                    <LevelBadge level={c.level} size="sm" />
                  ) : (
                    <span className="text-xs text-ink-3">{c.status === 'processing' ? 'Processing…' : c.status === 'unusable' ? 'Not scorable' : 'Failed'}</span>
                  )}
                </div>
                <div className="text-right">
                  {c.status === 'done' && (
                    <>
                      <div className="font-semibold tabular-nums">
                        {c.rawScore}/{c.rawMax}
                      </div>
                      {c.confidence && <ConfidenceTag confidence={c.confidence} />}
                    </>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <Disclaimer />
    </div>
  );
}
