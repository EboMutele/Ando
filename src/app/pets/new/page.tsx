'use client';

/* eslint-disable @next/next/no-img-element -- local object-URL preview */
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function NewPet() {
  const router = useRouter();
  const [species, setSpecies] = useState<'cat' | 'dog' | ''>('');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch('/api/pets', { method: 'POST', body: new FormData(e.currentTarget) });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) return setError(body.error ?? 'Could not save');
    router.push(`/pets/${body.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Add a pet</h1>

      <label className="flex flex-col items-center gap-2">
        <span className="grid h-28 w-28 place-items-center overflow-hidden rounded-full border border-dashed border-line bg-surface-2 text-sm text-ink-3">
          {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : 'Add photo'}
        </span>
        <input
          type="file"
          name="photo"
          accept="image/*"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />
        <span className="text-xs text-ink-3">Optional</span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Name</span>
        <input name="name" required maxLength={40} className="field" autoComplete="off" />
      </label>

      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Species</legend>
        <div className="grid grid-cols-2 gap-3">
          {(['cat', 'dog'] as const).map((s) => (
            <label
              key={s}
              className={`card flex h-14 cursor-pointer items-center justify-center text-base font-semibold ${species === s ? 'ring-2 ring-brand' : ''}`}
            >
              <input type="radio" name="species" value={s} required className="sr-only" onChange={() => setSpecies(s)} />
              {s === 'cat' ? 'Cat' : 'Dog'}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Age (years)</span>
          <input name="ageYears" type="number" inputMode="numeric" min={0} max={30} required className="field" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">+ months</span>
          <input name="ageMonths" type="number" inputMode="numeric" min={0} max={11} defaultValue={0} className="field" />
        </label>
      </div>

      {error && <p className="text-sm font-medium" style={{ color: 'var(--critical)' }}>{error}</p>}

      <button className="btn w-full" disabled={busy}>
        {busy ? 'Saving…' : 'Save pet'}
      </button>
    </form>
  );
}
