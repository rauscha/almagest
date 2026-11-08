/**
 * Recorded instruments: one note of a real instrument, repitched to the nearest key. Almagest's own engine,
 * since Parallax's are all oscillators. The files come from tools/samples/build.py; credits are in
 * public/samples/LICENSE.txt.
 *
 * Each voice plays one note, but a note it has left keeps sounding as it fades, so a chord change doesn't
 * cut off the one before. The piano can't slide (`slideRange` 0 makes the bank strike instead), as a piano
 * can't. Strings can, as a player shifts along the string.
 */
import type { ISynthEngine, MidiNote } from "../../vendor/parallax/src/audio/types";
import { rampTo, type Glides } from "./glide";

export const PIANO_ROOTS = Array.from({ length: 20 }, (_, i) => 33 + i * 3); // A1 to F#6, every minor third
export const STRING_ROOTS = [36, 43, 50, 57, 62, 69, 76, 83]; // cellos, then violins

export interface Instrument {
  dir: string;
  roots: number[];
  /** Plays the middle third of its file forever, where the note is steady. */
  loops: boolean;
  /** Seconds to reach full level after a strike. */
  attack: number;
  /** Seconds to fade away after the note is let go, down to about 2% of its level. */
  release: number;
  /** Seconds a note fades when its voice moves to another note. */
  handover: number;
  /** Furthest a slide can reach, in semitones. 0 means it always strikes. */
  slideRange: number;
  /** How far the five voices spread across the stereo field, for a mono source. */
  spread: number;
}

/** In the catalog's order: the index is the sound's `index` there. */
export const INSTRUMENTS: Instrument[] = [
  // The long release stands in for a held pedal: after the lift the strings keep ringing and fading on their own.
  { dir: "piano", roots: PIANO_ROOTS, loops: false, attack: 0.002, release: 16, handover: 1.2, slideRange: 0, spread: 0 },
  { dir: "strings", roots: STRING_ROOTS, loops: true, attack: 0.5, release: 1.4, handover: 0.35, slideRange: 127, spread: 0.45 },
];

/** The recorded note closest to this one, the lower of two equally close. */
export function nearestRoot(roots: number[], midi: number): number {
  return roots.reduce((best, r) => (Math.abs(r - midi) < Math.abs(best - midi) ? r : best));
}
export const rateFor = (root: number, midi: number) => 2 ** ((midi - root) / 12);

type Buffers = Map<number, AudioBuffer>[];
/** One decoded copy for all five voices, dropped when the last of them goes. */
let shared: Promise<Buffers> | null = null;
let users = 0;

async function loadAll(ctx: BaseAudioContext): Promise<Buffers> {
  return Promise.all(
    INSTRUMENTS.map(async ({ dir, roots }) => {
      const notes = await Promise.all(
        roots.map(async (root) => {
          const response = await fetch(`${import.meta.env.BASE_URL}samples/${dir}/${root}.ogg`);
          if (!response.ok) throw new Error(`No recording for ${dir} ${root}`);
          return [root, await ctx.decodeAudioData(await response.arrayBuffer())] as const;
        }),
      );
      return new Map(notes);
    }),
  );
}

/** Spread either side of the middle, in the order the bank builds its voices. */
const PLACES = [-1, 1, -0.5, 0.5, 0];
let built = 0;

type Sounding = { source: AudioBufferSourceNode; level: GainNode; root: number };

export class RecordedVoice implements ISynthEngine, Glides {
  manifest = {
    id: "recorded",
    name: "Recorded",
    description: "Recordings of real instruments, repitched.",
    capabilities: {},
  } as unknown as ISynthEngine["manifest"];
  slideRange = 0;
  output: StereoPannerNode | null = null;

  private ctx: AudioContext | null = null;
  private buffers: Buffers | null = null;
  private instrument = 0;
  private place = PLACES[built++ % PLACES.length];
  private now: Sounding | null = null;
  private joined = false;

  async init(ctx: AudioContext): Promise<void> {
    this.ctx = ctx;
    this.output = ctx.createStereoPanner();
    if (!this.joined) {
      this.joined = true;
      users++;
      shared ??= loadAll(ctx);
    }
    this.buffers = await shared;
    this.applyInstrument();
  }

  async dispose(): Promise<void> {
    this.allNotesOff();
    this.output?.disconnect();
    this.output = null;
    this.buffers = null;
    if (this.joined) {
      this.joined = false;
      if (--users === 0) shared = null;
    }
  }

  private applyInstrument() {
    const inst = INSTRUMENTS[this.instrument];
    this.slideRange = inst.slideRange;
    if (this.output) this.output.pan.value = this.place * inst.spread;
  }

  private fade(sounding: Sounding | null, seconds: number) {
    if (!sounding || !this.ctx) return;
    const at = this.ctx.currentTime;
    const gain = sounding.level.gain;
    const from = gain.value;
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(from, at);
    gain.setTargetAtTime(0, at, seconds / 4);
    try {
      sounding.source.stop(at + seconds + 0.2);
    } catch {
      /* already stopped */
    }
  }

  noteOn(midi: MidiNote): void {
    const { ctx, output, buffers } = this;
    if (!ctx || !output || !buffers) return;
    const inst = INSTRUMENTS[this.instrument];
    this.fade(this.now, inst.handover);
    const root = nearestRoot(inst.roots, midi);
    const buffer = buffers[this.instrument]?.get(root);
    if (!buffer) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rateFor(root, midi);
    let offset = 0;
    if (inst.loops) {
      source.loop = true;
      source.loopStart = buffer.duration / 3;
      source.loopEnd = (buffer.duration * 2) / 3;
      offset = source.loopStart + Math.random() * (buffer.duration / 3); // so a chord's voices don't move in step
    }
    const level = ctx.createGain();
    const at = ctx.currentTime;
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(1, at + inst.attack);
    source.connect(level).connect(output);
    source.onended = () => level.disconnect();
    source.start(at, offset);
    this.now = { source, level, root };
  }

  noteOff(): void {
    this.fade(this.now, INSTRUMENTS[this.instrument].release);
    this.now = null;
  }

  allNotesOff(): void {
    this.noteOff();
  }

  glide(_struck: number, midi: number, seconds: number): void {
    if (this.now) rampTo(this.now.source.playbackRate, this.ctx, rateFor(this.now.root, midi), seconds);
  }

  getParameterSchema() {
    return [];
  }

  setParameter(id: string, value: number): void {
    if (id !== "model") return;
    this.instrument = value;
    this.applyInstrument();
  }

  getParameter(id: string): number {
    return id === "model" ? this.instrument : 0;
  }
}
