import type { Feature, Species } from '../types';

export interface FeatureRubric {
  feature: Feature;
  label: string;
  /** Counted in the scale total. Supplementary items are shown but not summed. */
  inTotal: boolean;
  /** Anchors for 0, 1 and 2, worded as on the source scale. */
  anchors: [string, string, string];
}

export interface Scale {
  id: 'FGS' | 'CMPS-SF-derived';
  name: string;
  citation: string;
  features: FeatureRubric[];
  /** Normalized score (total ÷ max of scored items) at or above which the level is "elevated". */
  elevatedAt: number;
  mildAt: number;
  /** Conditions under which the scale must not be applied. */
  exclusions: string[];
}

/**
 * Feline Grimace Scale: five action units, 0–2 each. A ratio ≥ 0.39 (4/10
 * when all five are scored) is the published analgesic threshold.
 * Evangelista MC et al. (2019) Sci Rep 9:19128; Watanabe R et al. (2020)
 * Front Vet Sci 7:58 for real-time use.
 */
const FGS: Scale = {
  id: 'FGS',
  name: 'Feline Grimace Scale',
  citation:
    'Evangelista MC et al. Facial expressions of pain in cats: the development and validation of a Feline Grimace Scale. Sci Rep. 2019;9:19128.',
  elevatedAt: 0.39,
  mildAt: 0.2,
  exclusions: [
    'the cat is asleep or its eyes are closed for sleep',
    'the cat is eating, grooming, yawning or vocalizing in the frame',
  ],
  features: [
    {
      feature: 'ears',
      label: 'Ear position',
      inTotal: true,
      anchors: [
        'Ears facing forward',
        'Ears slightly pulled apart',
        'Ears flattened and rotated outwards',
      ],
    },
    {
      feature: 'eyes',
      label: 'Orbital tightening',
      inTotal: true,
      anchors: ['Eyes open', 'Eyes partially closed', 'Squinted eyes'],
    },
    {
      feature: 'muzzle',
      label: 'Muzzle tension',
      inTotal: true,
      anchors: [
        'Muzzle relaxed (round shape)',
        'Mild muzzle tension',
        'Tense muzzle (elliptical shape)',
      ],
    },
    {
      feature: 'whiskers',
      label: 'Whiskers change',
      inTotal: true,
      anchors: [
        'Whiskers loose (relaxed) and curved',
        'Whiskers slightly curved or straight (closer together)',
        'Whiskers straight and moving forward (away from the face)',
      ],
    },
    {
      feature: 'head',
      label: 'Head position',
      inTotal: true,
      anchors: [
        'Head above the shoulder line',
        'Head aligned with the shoulder line',
        'Head below the shoulder line or tilted down (chin toward the chest)',
      ],
    },
    {
      feature: 'posture',
      label: 'Body posture (supplementary)',
      inTotal: false,
      anchors: [
        'Relaxed, normal posture',
        'Tense or hunched at times',
        'Hunched, tucked or guarding a body area',
      ],
    },
    {
      feature: 'gait',
      label: 'Gait (supplementary)',
      inTotal: false,
      anchors: [
        'Moves normally',
        'Stiff, uneven or slow',
        'Clearly lame or reluctant to move',
      ],
    },
  ],
};

/**
 * Items of the Glasgow Composite Measure Pain Scale – Short Form that can be
 * observed on video (posture, mobility, attention to a body area), plus
 * facial cues reported in canine pain studies. The CMPS-SF itself requires
 * handling the dog, so this is a derived screening score, not a CMPS-SF score.
 * Reid J et al. (2007) Animal Welfare 16(S):97–104.
 */
const CMPS_DERIVED: Scale = {
  id: 'CMPS-SF-derived',
  name: 'Derived from the Glasgow Composite Measure Pain Scale (short form)',
  citation:
    'Reid J et al. Development of the short-form Glasgow Composite Measure Pain Scale (CMPS-SF) and derivation of an analgesic intervention score. Animal Welfare. 2007;16(S):97-104.',
  // CMPS-SF intervention level is 6/24 (0.25). The derived subset is weighted
  // toward the most painful-looking items, so Ando starts slightly higher and
  // treats it as provisional until validated against vet assessments.
  elevatedAt: 0.3,
  mildAt: 0.17,
  exclusions: [
    'the dog is asleep',
    'the dog is eating, playing with a toy or being handled in the frame',
  ],
  features: [
    {
      feature: 'ears',
      label: 'Ear carriage',
      inTotal: true,
      anchors: [
        'Ears in their usual relaxed position',
        'Ears held slightly back or lower than usual',
        'Ears pinned flat back or held stiffly down',
      ],
    },
    {
      feature: 'eyes',
      label: 'Eyes',
      inTotal: true,
      anchors: [
        'Eyes open and soft',
        'Eyes partly narrowed',
        'Squinting, or a fixed, glazed stare',
      ],
    },
    {
      feature: 'muzzle',
      label: 'Muzzle and mouth',
      inTotal: true,
      anchors: [
        'Relaxed mouth and lips',
        'Lips slightly drawn back or tense, or panting without exertion',
        'Lips pulled back tightly, grimace, or lip licking with tension',
      ],
    },
    {
      feature: 'head',
      label: 'Head carriage / attention to an area',
      inTotal: true,
      anchors: [
        'Head carried normally',
        'Head held lower than usual',
        'Head hanging low, or repeatedly turning to look at, lick or chew a body area',
      ],
    },
    {
      feature: 'posture',
      label: 'Posture (CMPS-SF)',
      inTotal: true,
      anchors: [
        'Comfortable, relaxed posture',
        'Unsettled or restless, shifting weight',
        'Rigid, hunched or tense',
      ],
    },
    {
      feature: 'gait',
      label: 'Mobility (CMPS-SF)',
      inTotal: true,
      anchors: [
        'Moves normally',
        'Lame, or stiff and uneven',
        'Slow or reluctant to rise or walk, or refuses to move',
      ],
    },
  ],
};

export function scaleFor(species: Species): Scale {
  return species === 'cat' ? FGS : CMPS_DERIVED;
}

/** Features a species is scored on. Dogs have no whisker item. */
export function featuresFor(species: Species): Feature[] {
  return scaleFor(species).features.map((f) => f.feature);
}
