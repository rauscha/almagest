/**
 * Only the chord engines, rather than Parallax's registry, which loads all five. Each gets
 * the one thing Almagest needs that Parallax's engines don't have: a glide on the audio clock, so a slide
 * stays smooth whatever the main thread is doing.
 */
import { PlaitsEngine } from "../../vendor/parallax/src/audio/engines/PlaitsEngine";
import { LaxsynthEngine } from "../../vendor/parallax/src/audio/engines/LaxsynthEngine";
import type { ISynthEngine, MidiNote, NoteOnOpts } from "../../vendor/parallax/src/audio/types";
import type { Glides } from "./glide";

/** Parallax keeps these private, and they're only read here. */
const insides = (engine: object) => engine as unknown as { node: AudioWorkletNode | null; ctx: AudioContext | null };

function rampTo(param: AudioParam | undefined, ctx: AudioContext | null, target: number, seconds: number) {
  if (!param || !ctx) return;
  const now = ctx.currentTime;
  const from = param.value; // read before canceling, so a slide interrupted midway carries on from there
  param.cancelScheduledValues(now);
  param.setValueAtTime(from, now);
  param.linearRampToValueAtTime(target, now + seconds);
}

/** Multi-model: pitch is the `note` parameter, in absolute semitones, with no limit that matters here. */
class MultiVoice extends PlaitsEngine implements Glides {
  slideRange = 127;

  private get note() {
    return insides(this).node?.parameters.get("note");
  }
  glide(_struck: number, midi: number, seconds: number): void {
    rampTo(this.note, insides(this).ctx, midi, seconds);
  }
  noteOn(midi: MidiNote, opts?: NoteOnOpts): void {
    // A slide still under way would carry on from the new note, so it has to go first.
    const ctx = insides(this).ctx;
    if (ctx) this.note?.cancelScheduledValues(ctx.currentTime);
    super.noteOn(midi, opts);
  }
}

/** The pad synth: pitch is an absolute `note` parameter, like multi-model's, and its envelope releases on noteOff. */
class PadVoice extends LaxsynthEngine implements Glides {
  slideRange = 127;

  private get note() {
    return insides(this).node?.parameters.get("note");
  }
  glide(_struck: number, midi: number, seconds: number): void {
    rampTo(this.note, insides(this).ctx, midi, seconds);
  }
  noteOn(midi: MidiNote, opts?: NoteOnOpts): void {
    const ctx = insides(this).ctx;
    if (ctx) this.note?.cancelScheduledValues(ctx.currentTime);
    super.noteOn(midi, opts);
  }

  /**
   * A slow sweep of the filter, which the pad synth hasn't got: a sine LFO added onto the cutoff
   * parameter, `sweepDepth` either side of the cutoff knob (cutoff is 0 to 1, so 0.1 is about ×2 in
   * frequency) at `sweepRate` Hz. Depth 0 turns it off. Every voice's LFO starts as the voices are built,
   * so a chord's voices open and close together.
   */
  private lfo: { osc: OscillatorNode; depth: GainNode } | null = null;
  setParameter(id: string, value: number, time?: number): void {
    if (id !== "sweepRate" && id !== "sweepDepth") return super.setParameter(id, value, time);
    const { ctx, node } = insides(this);
    const cutoff = node?.parameters.get("cutoff");
    if (!ctx || !cutoff) return;
    if (!this.lfo) {
      const osc = ctx.createOscillator();
      const depth = ctx.createGain();
      depth.gain.value = 0;
      osc.connect(depth).connect(cutoff);
      osc.start();
      this.lfo = { osc, depth };
    }
    const t = time ?? ctx.currentTime;
    if (id === "sweepRate") this.lfo.osc.frequency.setValueAtTime(value, t);
    else this.lfo.depth.gain.setTargetAtTime(value, t, 0.05);
  }
  async dispose(): Promise<void> {
    if (this.lfo) {
      try {
        this.lfo.osc.stop();
        this.lfo.osc.disconnect();
        this.lfo.depth.disconnect();
      } catch {
        /* already stopped */
      }
      this.lfo = null;
    }
    return super.dispose();
  }
}

export const makeEngine = (id: string): ISynthEngine =>
  id === "pad" ? new PadVoice() : new MultiVoice();
