import { notFound } from 'next/navigation';
import * as repo from '@/lib/db/repo';
import { CLIP_MAX_S, CLIP_MIN_S } from '@/lib/pipeline';
import { Disclaimer } from '@/components/Disclaimer';
import { VideoUpload } from '@/components/VideoUpload';

export const dynamic = 'force-dynamic';

export default async function NewCheck({ params }: { params: Promise<{ petId: string }> }) {
  const { petId } = await params;
  const pet = repo.getPet(petId);
  if (!pet) notFound();
  const face = pet.species === 'cat' ? 'ears, eyes and whiskers' : 'ears, eyes and mouth';

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">New check for {pet.name}</h1>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">For a good reading</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>
            Film {CLIP_MIN_S}–{CLIP_MAX_S} seconds, in daylight or a well-lit room.
          </li>
          <li>Get {pet.name}&apos;s face in view — {face} — for most of the clip.</li>
          <li>Include a few steps of walking if you can; it lets Ando look at gait.</li>
          <li>Film while {pet.name} is awake and resting, not eating, grooming or playing.</li>
          <li>Hold the phone at {pet.name}&apos;s eye level, about an arm&apos;s length away.</li>
        </ul>
      </section>

      <VideoUpload petId={pet.id} petName={pet.name} minS={CLIP_MIN_S} maxS={CLIP_MAX_S} />
      <Disclaimer />
    </div>
  );
}
