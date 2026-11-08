/**
 * Which sounds Almagest offers, under its own labels. Never use an engine's manifest name here.
 *
 * The list comes from a spectral survey of every sound (tools/survey): does it play the notes
 * it claims? The survey judged most sounds at their default knobs. Sounds it called close went to
 * a listening test, which kept Waveshaper and dropped the rest. The pads are knob settings of
 * their own, and the survey judged them at exactly those settings.
 */
import { PLAITS_MODELS } from "../../vendor/parallax/src/data/plaits-models";
import type { EngineEntry } from "../core/core";

type Knobs = Record<string, number>;
export interface SoundPreset {
  name: string;
  /** The engine's own model index. */
  index: number;
  /** Every knob this sound depends on, so changing sound never leaves another's settings behind. */
  knobs: Knobs;
  /** A trim for one sound that sits louder than the rest of its engine. 1 when absent. */
  level?: number;
}

const MULTI_CODES = ["VAF", "VA", "WT", "FORM", "6OPA", "6OPC", "TERR", "WSH"];
/** Passed the survey as close calls, then dropped by ear. */
export const DROPPED_BY_EAR = ["Reed Piano", "Thumb Bass", "Growl Bass"];

const MULTI_DEFAULTS: Knobs = { harmonics: 0.5, timbre: 0.5, morph: 0.5 };
/**
 * Bank A peaked at 0.89 to 1.06 of full scale in tools/verify/drive_app.cjs, the only sound that close,
 * with the most energy of any (rms 0.41 against 0.2 to 0.36). Trimmed 2.5 dB.
 */
const MULTI_LEVEL: Record<string, number> = { "6OPA": 0.75 };
const plaits = (code: string) => {
  const m = PLAITS_MODELS.find((x) => x.code === code);
  if (!m) throw new Error(`No sound with code ${code}`);
  return m;
};

export const MULTI: SoundPreset[] = [
  ...MULTI_CODES.map((code) => ({ name: plaits(code).name, index: plaits(code).index, knobs: MULTI_DEFAULTS, level: MULTI_LEVEL[code] })),
  // Two oscillators pulled apart until they beat: the stacked-saw sound of the M8's HyperSynth, more or less.
  { name: "Wide Saw", index: plaits("VA").index, knobs: { harmonics: 0.52, timbre: 0, morph: 0.75 } },
];

/**
 * Pads, on Parallax's own wavetable synth: a slow attack, a long release and a low-pass filter. The
 * filter's cutoff is 20 Hz × 900^value, so 0.5 is about 600 Hz and 0.75 about 3 kHz. The sweep is Almagest's
 * own, a slow LFO on the cutoff (src/voices/engines.ts), off unless a sound sets its depth.
 */
const PAD_BASE: Knobs = {
  size: 6, mult: 1, warp: 0, mirror: 0, filterType: 0, resonance: 0.1, drive: 0, driveMode: 0, crush: 0,
  decay: 0.6, sustain: 0.85, gain: 0.5, sweepRate: 0.1, sweepDepth: 0,
};
export const PAD_SHAPE = { sine: 0, tri: 1, saw: 2, pulse: 4 };
export const PAD: SoundPreset[] = [
  { name: "Soft Saw", index: PAD_SHAPE.saw, knobs: { ...PAD_BASE, cutoff: 0.64, resonance: 0.08, attack: 0.35, release: 1.4 } },
  { name: "Dark Saw", index: PAD_SHAPE.saw, knobs: { ...PAD_BASE, cutoff: 0.5, resonance: 0.18, attack: 0.55, sustain: 0.9, release: 1.8, gain: 0.33 } },
  // Not quite pure: a touch of asymmetry and a soft clip on the peaks, so it isn't too clean.
  { name: "Warm Sine", index: PAD_SHAPE.sine, knobs: { ...PAD_BASE, warp: 0.06, drive: 0.025, cutoff: 0.75, attack: 0.25, release: 1.3 } },
  // A filter that keeps moving, as Bank C's does: about 8 s to open and close.
  { name: "Slow Sweep", index: PAD_SHAPE.saw, knobs: { ...PAD_BASE, cutoff: 0.56, resonance: 0.3, attack: 0.4, release: 1.6, sweepRate: 0.12, sweepDepth: 0.13, gain: 0.42 } },
  // A slower, darker one. A pulse failed the survey (54% of a chord's energy on its notes) and a triangle
  // has too few overtones for the sweep to be heard, so it's a saw again.
  { name: "Long Sweep", index: PAD_SHAPE.saw, knobs: { ...PAD_BASE, cutoff: 0.54, resonance: 0.15, attack: 0.5, sustain: 0.9, release: 1.8, sweepRate: 0.05, sweepDepth: 0.17, gain: 0.4 } },
];

const BY_ENGINE: Record<string, SoundPreset[]> = { multi: MULTI, pad: PAD };

export const CATALOG: EngineEntry[] = [
  { id: "pad", label: "Pad synth", models: PAD.map((m) => m.name) },
  { id: "multi", label: "Multi-model", models: MULTI.map((m) => m.name) },
];

/** The bus level for a sound: its engine's level, times its own trim if it has one. */
export const engineLevel = (engine: string, position = 0) =>
  (engine === "pad" ? PAD_LEVEL : 1) * (BY_ENGINE[engine]?.[position]?.level ?? 1);
/** Set from the live levels in tools/verify/drive_app.cjs. */
const PAD_LEVEL = 0.55;

/** A sound's position in the list above, to the index the engine expects. */
export function engineModelIndex(engine: string, position: number): number {
  return BY_ENGINE[engine]?.[position]?.index ?? 0;
}

/** The knobs a sound needs, all of them, so a sound chosen after another doesn't inherit its settings. */
export function engineKnobs(engine: string, position: number): Knobs {
  return BY_ENGINE[engine]?.[position]?.knobs ?? {};
}
