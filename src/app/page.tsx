import Link from 'next/link';
import * as repo from '@/lib/db/repo';
import { formatAge, presentPet } from '@/lib/present';
import { LevelBadge } from '@/components/LevelBadge';
import { PetAvatar } from '@/components/PetAvatar';

export const dynamic = 'force-dynamic';

export default function Home() {
  const pets = repo.listPets().map((p) => {
    const checks = repo.listChecks(p.id).filter((c) => c.status === 'done');
    return { ...presentPet(p), last: checks.at(-1) ?? null, alerts: repo.openAlerts(p.id) };
  });

  return (
    <div className="space-y-6">
      <section className="pt-2">
        <h1 className="text-2xl font-bold tracking-tight">Notice pain sooner.</h1>
        <p className="mt-1 text-ink-2">
          Film your cat or dog for 5–15 seconds. Ando checks their face and posture against veterinary pain scales and tracks it over time.
        </p>
      </section>

      <ul className="space-y-3">
        {pets.map((p) => (
          <li key={p.id}>
            <Link href={`/pets/${p.id}`} className="card flex items-center gap-4 p-4 active:opacity-80">
              <PetAvatar pet={p} size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-lg font-semibold">{p.name}</span>
                  {p.alerts.some((a) => a.kind === 'sustained') && (
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: 'var(--critical)' }}>
                      Alert
                    </span>
                  )}
                </div>
                <div className="text-sm text-ink-2">
                  {p.species === 'cat' ? 'Cat' : 'Dog'} · {formatAge(p.ageMonths)}
                </div>
                <div className="mt-1">
                  {p.last?.level ? <LevelBadge level={p.last.level} size="sm" /> : <span className="text-xs text-ink-3">No checks yet</span>}
                </div>
              </div>
              <svg viewBox="0 0 20 20" className="h-5 w-5 text-ink-3" aria-hidden fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 4l6 6-6 6" />
              </svg>
            </Link>
          </li>
        ))}
      </ul>

      <Link href="/pets/new" className="btn w-full">
        + Add a pet
      </Link>

      {pets.length === 0 && (
        <p className="text-center text-sm text-ink-3">
          Tip: run <code>npm run seed</code> to add the demo cat, Luna, with two weeks of checks.
        </p>
      )}
    </div>
  );
}
