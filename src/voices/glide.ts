import type { ISynthEngine } from "../../vendor/parallax/src/audio/types";

/** What a voice needs for a slide. A voice without it strikes instead. */
export interface Glides {
  /** Furthest a slide can reach from the note that was struck, in semitones. */
  slideRange: number;
  /** Slide to `midi` without striking. `struck` is the note the voice last struck. */
  glide(struck: number, midi: number, seconds: number): void;
}
export const canGlide = (v: ISynthEngine): v is ISynthEngine & Glides => "glide" in v;

/** A straight ramp on the audio clock, carrying on from wherever an interrupted one had reached. */
export function rampTo(param: AudioParam | undefined, ctx: AudioContext | null, target: number, seconds: number) {
  if (!param || !ctx) return;
  const now = ctx.currentTime;
  const from = param.value; // read before canceling, so a slide interrupted midway carries on from there
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(target, now + seconds);
}
