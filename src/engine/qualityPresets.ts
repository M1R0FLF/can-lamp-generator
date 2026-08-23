export interface QualityPreset {
  label: string;
  pitch: number;
  dMin: number;
  dMax: number;
  jitter: number;
}

// "Standard" is the Mango Salvaje reference tuple (CLAUDE.md: pitch 1.45,
// 0.28-0.52mm, jitter 0.15) — the tuple known to work. The others scale
// density/detail up and down from it; live min-web is the real check, not
// these nominal numbers.
export const QUALITY_PRESETS: QualityPreset[] = [
  { label: 'Draft', pitch: 2.2, dMin: 0.32, dMax: 0.62, jitter: 0.15 },
  { label: 'Standard', pitch: 1.45, dMin: 0.28, dMax: 0.52, jitter: 0.15 },
  { label: 'Fine', pitch: 1.15, dMin: 0.24, dMax: 0.46, jitter: 0.15 },
  { label: 'Ultra', pitch: 0.98, dMin: 0.2, dMax: 0.4, jitter: 0.05 },
];

export const DEFAULT_QUALITY_INDEX = 1; // Standard
export const DEFAULT_MIN_WEB_TARGET = 0.3; // mm, per CLAUDE.md rule 2
export const DEFAULT_SEC_PER_HOLE = 0.04; // rough pierce+cut assumption, user-tunable
