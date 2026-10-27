'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Phase = { kind: 'idle' } | { kind: 'ready'; duration: number } | { kind: 'uploading'; pct: number } | { kind: 'processing' };

/**
 * Record (the `capture` attribute opens the rear camera on phones) or pick a
 * clip, check its length in the browser before uploading, then upload with
 * progress. The server re-validates everything.
 */
export function VideoUpload({ petId, petName, minS, maxS }: { petId: string; petName: string; minS: number; maxS: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const recordRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  function choose(f: File | undefined) {
    setError(null);
    setPhase({ kind: 'idle' });
    if (!f) return;
    setFile(f);
    setUrl(URL.createObjectURL(f));
  }

  function onMetadata(e: React.SyntheticEvent<HTMLVideoElement>) {
    const d = e.currentTarget.duration;
    if (!Number.isFinite(d)) return setPhase({ kind: 'ready', duration: NaN }); // some browsers can't tell; server checks
    if (d < minS - 0.5) return setError(`That clip is ${d.toFixed(1)} s. Please film at least ${minS} seconds.`);
    if (d > maxS + 0.5) return setError(`That clip is ${d.toFixed(1)} s. Please keep it under ${maxS} seconds — trim it or film again.`);
    setPhase({ kind: 'ready', duration: d });
  }

  function upload() {
    if (!file) return;
    setError(null);
    const form = new FormData();
    form.append('video', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/pets/${petId}/checks`);
    xhr.upload.onprogress = (e) => e.lengthComputable && setPhase({ kind: 'uploading', pct: Math.round((e.loaded / e.total) * 100) });
    xhr.upload.onload = () => setPhase({ kind: 'processing' });
    xhr.onload = () => {
      const body = JSON.parse(xhr.responseText || '{}');
      if (xhr.status === 202) return router.push(`/checks/${body.checkId}`);
      setError(body.error ?? 'Upload failed. Please try again.');
      setPhase({ kind: 'idle' });
    };
    xhr.onerror = () => {
      setError('Upload failed — check your connection and try again.');
      setPhase({ kind: 'idle' });
    };
    setPhase({ kind: 'uploading', pct: 0 });
    xhr.send(form);
  }

  const busy = phase.kind === 'uploading' || phase.kind === 'processing';

  return (
    <div className="space-y-3">
      <input ref={recordRef} type="file" accept="video/*" capture="environment" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
      <input ref={pickRef} type="file" accept="video/*" className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />

      {url ? (
        <video src={url} controls playsInline muted onLoadedMetadata={onMetadata} className="aspect-video w-full rounded-2xl bg-black object-contain" />
      ) : (
        <div className="grid aspect-video w-full place-items-center rounded-2xl border border-dashed border-line bg-surface-2 text-sm text-ink-3">
          No video yet
        </div>
      )}

      {error && (
        <p className="text-sm font-medium" style={{ color: 'var(--critical)' }} role="alert">
          {error}
        </p>
      )}

      {phase.kind === 'ready' && !error ? (
        <button className="btn w-full" onClick={upload}>
          Check {petName}
          {Number.isFinite(phase.duration) ? ` (${phase.duration.toFixed(0)} s clip)` : ''}
        </button>
      ) : busy ? (
        <div className="space-y-2">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full bg-brand transition-all" style={{ width: phase.kind === 'uploading' ? `${phase.pct}%` : '100%' }} />
          </div>
          <p className="text-center text-sm text-ink-2">{phase.kind === 'uploading' ? `Uploading… ${phase.pct}%` : 'Preparing the video…'}</p>
        </div>
      ) : null}

      {!busy && (
        <div className="grid grid-cols-2 gap-3">
          <button className="btn" onClick={() => recordRef.current?.click()}>
            Record
          </button>
          <button className="btn btn-ghost" onClick={() => pickRef.current?.click()}>
            Choose video
          </button>
        </div>
      )}
    </div>
  );
}
