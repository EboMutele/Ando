'use client';

/* eslint-disable @next/next/no-img-element -- media is served from our own API route */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CheckView, PetView } from '@/lib/present';
import { Disclaimer } from './Disclaimer';
import { ConfidenceTag, LevelBadge } from './LevelBadge';

const STAGES = [
  { stage: 'ingest', label: 'Preparing video' },
  { stage: 'keyframes', label: 'Picking the clearest frames' },
  { stage: 'segment', label: 'Finding face and body (SAM 3.1)' },
  { stage: 'score', label: 'Scoring against the pain scale (Muse Spark)' },
] as const;

export function CheckResult({ initial, pet }: { initial: CheckView; pet: PetView }) {
  const [check, setCheck] = useState(initial);
  const [showSam, setShowSam] = useState(true);

  useEffect(() => {
    if (check.status !== 'processing') return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/checks/${check.id}`, { cache: 'no-store' });
      if (res.ok) setCheck(await res.json());
    }, 1500);
    return () => clearInterval(t);
  }, [check.id, check.status]);

  const back = (
    <Link href={`/pets/${pet.id}`} className="text-sm text-ink-2">
      ← {pet.name}
    </Link>
  );

  if (check.status === 'processing') {
    const current = STAGES.findIndex((s) => s.stage === check.stage);
    return (
      <div className="space-y-5">
        {back}
        <h1 className="text-2xl font-bold tracking-tight">Checking {pet.name}…</h1>
        <ol className="card space-y-3 p-4" aria-live="polite">
          {STAGES.map((s, i) => (
            <li key={s.stage} className={`flex items-center gap-3 ${i > current ? 'text-ink-3' : ''}`}>
              <span
                className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${i < current ? 'bg-brand text-brand-ink' : 'border border-line'}`}
              >
                {i < current ? '✓' : i === current ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand" /> : i + 1}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
        <p className="text-sm text-ink-3">This usually takes under a minute. You can leave this page; the result will be saved.</p>
      </div>
    );
  }

  if (check.status !== 'done') {
    return (
      <div className="space-y-5">
        {back}
        <h1 className="text-2xl font-bold tracking-tight">{check.status === 'unusable' ? "We couldn't score this clip" : 'Something went wrong'}</h1>
        <p className="card p-4 text-ink-2">{check.error}</p>
        <Link href={`/pets/${pet.id}/check`} className="btn w-full">
          Try another clip
        </Link>
        <Disclaimer />
      </div>
    );
  }

  const inTotal = check.features.filter((f) => f.inTotal);
  const extra = check.features.filter((f) => !f.inTotal);
  const frames = check.keyFrames;

  return (
    <div className="space-y-5">
      {back}
      {check.simulated && (
        <p className="rounded-xl px-3 py-2 text-sm font-semibold" style={{ background: 'var(--warning)', color: '#0b0b0b' }}>
          Demo data (seeded, or from the local mock API) — not a real assessment.
        </p>
      )}

      <section className="card space-y-3 p-4">
        <div className="text-sm text-ink-3">
          {new Date(check.recordedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
        {check.level && <LevelBadge level={check.level} />}
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-bold tabular-nums">{check.rawScore}</span>
          <span className="text-lg text-ink-2">/ {check.rawMax}</span>
        </div>
        <div className="text-sm text-ink-2">
          {check.scaleName}
          {check.rawMax !== (pet.species === 'cat' ? 10 : 12) && ' — some items could not be seen and were left out'}
        </div>
        {check.confidence && <ConfidenceTag confidence={check.confidence} />}
        {check.note && <p className="text-base leading-relaxed">{check.note}</p>}
        <Disclaimer />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">What Ando looked at</h2>
        <ul className="card divide-y divide-line">
          {[...inTotal, ...extra].map((f) => (
            <li key={f.feature} className="flex gap-3 p-3">
              <ScoreDots score={f.score} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium">{f.label}</span>
                  <span className="text-xs text-ink-3">{f.score === null ? 'not visible' : `${f.score} / 2`}</span>
                </div>
                {f.anchor && <div className="text-sm text-ink-2">{f.anchor}</div>}
                {f.evidence && <div className="mt-0.5 text-xs text-ink-3">{f.evidence}</div>}
              </div>
            </li>
          ))}
        </ul>
        {extra.length > 0 && <p className="text-xs text-ink-3">Items marked supplementary are recorded but are not part of the scale total.</p>}
      </section>

      {frames.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Key frames</h2>
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <input type="checkbox" checked={showSam} onChange={(e) => setShowSam(e.target.checked)} />
              SAM 3.1 masks
            </label>
          </div>
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
            {frames.map((k) => (
              <figure key={k.idx} className="w-44 shrink-0 snap-start space-y-1">
                <img
                  src={(showSam && k.overlayUrl) || k.frameUrl || ''}
                  alt={`Frame ${k.idx} at ${k.tS} seconds`}
                  className="aspect-square w-full rounded-xl bg-black object-contain"
                />
                <figcaption className="flex items-center gap-2 text-xs text-ink-3">
                  {k.faceCropUrl && <img src={k.faceCropUrl} alt="" className="h-8 w-8 rounded-md object-cover" />}
                  Frame {k.idx} · {k.tS}s{k.faceBox ? '' : ' · face not found'}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {check.qualityIssues.length > 0 && (
        <section className="card space-y-1 p-4 text-sm">
          <h2 className="font-semibold">About this clip</h2>
          <ul className="list-disc pl-5 text-ink-2">
            {check.qualityIssues.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-ink-3">
        Scale: {check.scaleCitation}
        {check.models && ` Models: ${Object.values(check.models).join(', ')}.`}
      </p>

      <Link href={`/pets/${pet.id}`} className="btn btn-ghost w-full">
        See {pet.name}&apos;s trend
      </Link>
    </div>
  );
}

function ScoreDots({ score }: { score: 0 | 1 | 2 | null }) {
  return (
    <span className="mt-1 flex shrink-0 gap-1" aria-hidden>
      {[1, 2].map((i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-full border"
          style={{
            borderColor: score === null ? 'var(--line)' : 'var(--ink-2)',
            background: score !== null && score >= i ? (score === 2 ? 'var(--critical)' : 'var(--warning)') : 'transparent',
          }}
        />
      ))}
    </span>
  );
}
