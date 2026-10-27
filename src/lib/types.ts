export type Species = 'cat' | 'dog';
export type Feature = 'ears' | 'eyes' | 'muzzle' | 'whiskers' | 'head' | 'posture' | 'gait';
export type Confidence = 'low' | 'medium' | 'high';
export type Level = 'none' | 'mild' | 'elevated';
export type CheckStatus = 'processing' | 'done' | 'unusable' | 'failed';
export type CheckStage = 'ingest' | 'keyframes' | 'segment' | 'score' | 'done';

/** Half-open pixel box in source-frame coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Pet {
  id: string;
  name: string;
  species: Species;
  ageMonths: number;
  photoPath: string | null;
  createdAt: string;
}

export interface FeatureResult {
  feature: Feature;
  score: 0 | 1 | 2 | null;
  inTotal: boolean;
  confidence: Confidence | null;
  evidence: string | null;
}

export interface KeyFrame {
  idx: number;
  tS: number;
  sharpness: number | null;
  framePath: string;
  faceCropPath: string | null;
  overlayPath: string | null;
  faceBox: Box | null;
  bodyBox: Box | null;
  faceConf: number | null;
  bodyConf: number | null;
}

export interface Check {
  id: string;
  petId: string;
  status: CheckStatus;
  stage: CheckStage;
  error: string | null;
  recordedAt: string;
  createdAt: string;
  videoPath: string | null;
  durationS: number | null;
  scale: string | null;
  rawScore: number | null;
  rawMax: number | null;
  score: number | null;
  level: Level | null;
  confidence: Confidence | null;
  moving: boolean | null;
  note: string | null;
  simulated: boolean;
  models: Record<string, string> | null;
  qualityIssues: string[];
  features: FeatureResult[];
  keyFrames: KeyFrame[];
}

export interface Alert {
  id: number;
  petId: string;
  kind: 'sustained' | 'rising';
  message: string;
  firstDay: string;
  lastDay: string;
  createdAt: string;
  dismissedAt: string | null;
}

export const DISCLAIMER = "Not a diagnosis. If you're worried, see a vet.";
