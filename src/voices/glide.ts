import type { ISynthEngine } from "../../vendor/parallax/src/audio/types";

/** What a voice needs for a slide. A voice without it strikes instead. */
export interface Glides {
  /** Furthest a slide can reach from the note that was struck, in semitones. */
  slideRange: number;
  /** Slide to `midi` without striking. `struck` is the note the voice last struck. */
  glide(struck: number, midi: number, seconds: number): void;
}
export const canGlide = (v: ISynthEngine): v is ISynthEngine & Glides => "glide" in v;
