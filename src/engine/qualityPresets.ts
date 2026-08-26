export interface QualityPreset {
  label: string;
  pitch: number;
  dMin: number;
  dMax: number;
  jitter: number;
}

// "Standard" is the Mango Salvaje reference tuple (CLAUDE.md: pitch 1.45,
// 0.28-0.52mm). The others scale density/detail up and down from it; live
// min-web is the real check, not these nominal numbers.
//
// `jitter` is deliberately CONSTANT across the ladder, so Quality moves
// resolution and nothing else — see CLAUDE.md rule 10a. It used to run
// 0.15/0.15/0.15/0.05, which made Ultra the only rung that looked like a
// lattice and left the other three visibly scattered: jitter displaces each
// hole by `jitter * pitch`, and against the hole's own diameter that was 53%
// at Draft, 42% at Standard and 37% at Fine against Ultra's 12%. Picking a
// finer Quality therefore restyled the artwork instead of resolving it.
//
// 0.05 is Ultra's shipped value, i.e. the one a human looked at and liked, and
// holding it everywhere lands every rung at 12-18% of a hole diameter. It is
// also a large safety win under rule 2, because jitter erodes the web from
// both holes at once (worst-case web, full tone, hash):
//
//   tuple      jitter 0.15   jitter 0.05
//   Draft         0.847mm       1.329mm
//   Standard      0.424mm       0.756mm
//   Fine          0.303mm       0.557mm    <- was at the 0.30mm floor
//   Ultra         0.242mm       0.466mm    <- why Ultra dropped it in the first place
//
// Maximum open area is unchanged to 2 decimal places at every rung (7.22 /
// 11.67 / 14.59 / 15.05%), so this is not a brightness change — rule 10's
// requirement that a non-tone axis stay flat in open area.
//
// Do not go below 0.05 here. At jitter 0 the hash screen degenerates into
// visible chains (measured nearest-neighbour direction concentration at
// mid-tone jumps 0.05 -> 0.47 at Standard), and a near-zero jitter at a fine
// pitch reads as vertical striping, which wants `rowShift` instead — see the
// note on StippleParams.rowShift.
export const QUALITY_PRESETS: QualityPreset[] = [
  { label: 'Draft', pitch: 2.2, dMin: 0.32, dMax: 0.62, jitter: 0.05 },
  { label: 'Standard', pitch: 1.45, dMin: 0.28, dMax: 0.52, jitter: 0.05 },
  { label: 'Fine', pitch: 1.15, dMin: 0.24, dMax: 0.46, jitter: 0.05 },
  { label: 'Ultra', pitch: 0.98, dMin: 0.2, dMax: 0.4, jitter: 0.05 },
];

export const DEFAULT_QUALITY_INDEX = 1; // Standard
export const DEFAULT_MIN_WEB_TARGET = 0.3; // mm, per CLAUDE.md rule 2

/**
 * Open-area guardrail, per CLAUDE.md rule 8 ("boring is fine, empty and
 * overstuffed are not"). Calibrated against a rated pass over all 13
 * presets at Standard quality on a Ø65x142mm can:
 *
 *   Flagged as too sparse (bad/average, "mostly black"):
 *     Current 1.3% (deleted), Abyss 1.3%, Seigaiha 1.7%, Orrery 1.5%
 *   Passed (good):
 *     Roadster 2.0%, Circuit 2.3%, Deco/Metropolis 2.7%, Mango Salvaje 3.0%,
 *     Horizon 3.5%, Alpenglow/Girih 4.3%, Escarcha 4.5%
 *
 * The floor sits right in the 1.7-2.0% gap that split those two groups
 * cleanly. The ceiling has no real bad example yet (nothing rated has come
 * close) — it's a precautionary guard against a preset leaving no dark
 * ground at all, not a calibrated line. Revisit both if a new preset
 * disagrees.
 */
export const DEFAULT_OPEN_AREA_MIN_PCT = 1.8;
export const DEFAULT_OPEN_AREA_MAX_PCT = 8;

/**
 * Cut-time model, calibrated against two real jobs on an xTool fiber 20W
 * with rotary attachment (speed 10 mm/s, 5 passes):
 *
 *   Mango Salvaje, default quality: 6,008 holes -> 3h30m measured
 *   Escarcha,      default quality: 7,965 holes -> 3h50m measured
 *
 * Model: time = holes * K * passes / speed. A perimeter-based model (time
 * driven by each hole's circumference, i.e. bigger holes cost more) was
 * tried first and fit WORSE — implied per-hole overhead varied 40% between
 * the two jobs instead of 21%. That's consistent with a rotary attachment:
 * unlike a galvo, which can reverse direction almost instantly, the rotary
 * axis has real inertia, so repositioning between holes isn't meaningfully
 * faster than cutting itself. Time is dominated by per-hole overhead that
 * itself scales with the speed setting, not by tracing more perimeter.
 *
 * Fitting K from both jobs pooled (hole-count-weighted) and checking each
 * job individually gives about +/-10% error — see the derivation in
 * CLAUDE.md-adjacent commit history if this ever needs re-deriving. That's
 * the honest error bar with two data points; treat the estimate as rough.
 *
 * Known blind spot: hole SIZE isn't in the model at all. Both calibration
 * jobs used similar average hole diameters (~0.42-0.45mm); a job with much
 * larger fixed holes will likely take longer than this predicts. Refine
 * with a perimeter term if a data point with a very different hole size
 * shows up.
 */
export const CUT_TIME_K = 3.78;
export const DEFAULT_LASER_SPEED = 10; // mm/s
export const DEFAULT_LASER_PASSES = 5;

/**
 * `extraPathMm` is continuous cut LENGTH (the bottom separation cut, at
 * pi*D per pass), charged at plain length/speed rather than through
 * CUT_TIME_K. The per-hole constant above is dominated by rotary
 * repositioning overhead, and a single unbroken circumferential cut has none:
 * the axis just spins. That makes this term the one place the model is
 * honestly a path-length model — it is also uncalibrated, but it is small
 * (~1.7 min at Standard on a 65mm can) next to the perforation time it sits
 * beside, so a rough term beats leaving it out and under-reporting.
 */
export function estimateCutSeconds(
  holeCount: number,
  speedMmS: number,
  passes: number,
  extraPathMm = 0
): number {
  if (speedMmS <= 0) return Infinity;
  return (holeCount * CUT_TIME_K + extraPathMm) * passes / speedMmS;
}
