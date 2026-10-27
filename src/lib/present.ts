import { mediaUrl } from './storage';
import { scaleFor } from './scoring/scales';
import type { Check, Pet } from './types';

/** Check as sent to the browser: storage keys become URLs, rubric labels attached. */
export function presentCheck(check: Check, pet: Pet) {
  const scale = scaleFor(pet.species);
  return {
    ...check,
    videoUrl: mediaUrl(check.videoPath),
    scaleName: scale.name,
    scaleCitation: scale.citation,
    elevatedAt: scale.elevatedAt,
    features: check.features.map((f) => {
      const rubric = scale.features.find((r) => r.feature === f.feature);
      return { ...f, label: rubric?.label ?? f.feature, anchor: f.score === null ? null : (rubric?.anchors[f.score] ?? null) };
    }),
    keyFrames: check.keyFrames.map((k) => ({
      ...k,
      frameUrl: mediaUrl(k.framePath),
      faceCropUrl: mediaUrl(k.faceCropPath),
      overlayUrl: mediaUrl(k.overlayPath),
    })),
  };
}

export type CheckView = ReturnType<typeof presentCheck>;

export function presentPet(pet: Pet) {
  return { ...pet, photoUrl: mediaUrl(pet.photoPath) };
}

export type PetView = ReturnType<typeof presentPet>;

export function formatAge(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  return m ? `${y} y ${m} mo` : `${y} y`;
}
