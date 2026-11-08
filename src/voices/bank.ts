/**
 * The only code that touches audio. Parallax's engines are monophonic, so N voices are N engine
 * instances, created once and reused.
 */
import type { ISynthEngine } from "../../vendor/parallax/src/audio/types";
import type { Sound } from "../core/core";
import type { VoiceCommand } from "../core/reduce";
import { VOICE_COUNT } from "../theory/voicing";
import { canGlide } from "./glide";

type MakeEngine = (id: string) => ISynthEngine;

/** Five voices together, with the limiter after this as the safety. */
const BUS_LEVEL = 0.55;

export class VoiceBank implements Sound {
  private voices: ISynthEngine[] = [];
  /** The note each voice last struck. `noteOff` is ignored unless it names this note. */
  private struck: (number | null)[] = [];
  private bus: GainNode;
  private busy: Promise<void> = Promise.resolve();
  /** Whether this sound is heard at all. The voices keep running either way, so it comes back at once. */
  private own = true;
  private position = 0;

  constructor(
    private ctx: AudioContext,
    private make: MakeEngine,
    private modelIndex: (engine: string, position: number) => number,
    output: AudioNode,
    private levelFor: (engine: string, position: number) => number = () => 1,
    private knobsFor: (engine: string, position: number) => Record<string, number> = () => ({}),
    private engine = "",
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = BUS_LEVEL;
    this.bus.connect(output);
  }

  /** Builds the voices. Everything else is safe to call before this finishes. */
  useEngine(engine: string, position: number): Promise<void> {
    this.busy = this.busy.then(async () => {
      await Promise.all(this.voices.map((v) => v.dispose()));
      this.voices = [];
      this.struck = [];
      this.engine = engine;
      this.position = position;
      this.bus.gain.value = this.level();
      const next: ISynthEngine[] = [];
      for (let i = 0; i < VOICE_COUNT; i++) {
        const v = this.make(engine);
        await v.init(this.ctx);
        v.output?.connect(this.bus);
        this.setSound(v, engine, position);
        next.push(v);
      }
      this.voices = next;
      this.struck = next.map(() => null);
    });
    return this.busy;
  }

  useModel(position: number): void {
    // A sound can carry its own trim, so the bus follows it, smoothly enough not to click.
    this.position = position;
    this.bus.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.01);
    for (const v of this.voices) this.setSound(v, this.engine, position);
  }

  setOwnSound(on: boolean): void {
    this.own = on;
    this.bus.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.01);
  }

  private level(): number {
    return this.own ? BUS_LEVEL * this.levelFor(this.engine, this.position) : 0;
  }

  private setSound(v: ISynthEngine, engine: string, position: number): void {
    v.setParameter("model", this.modelIndex(engine, position));
    for (const [knob, value] of Object.entries(this.knobsFor(engine, position))) v.setParameter(knob, value);
  }

  apply(commands: VoiceCommand[]): void {
    for (const c of commands) {
      if (c.kind === "allOff") {
        this.voices.forEach((_, voice) => this.off(voice));
      } else if (c.kind === "off") {
        this.off(c.voice);
      } else if (c.kind === "slide") {
        this.slide(c.voice, c.midi, c.ms);
      } else {
        this.strike(c.voice, c.midi);
      }
    }
  }

  private strike(voice: number, midi: number): void {
    const v = this.voices[voice];
    if (!v) return;
    v.noteOn(midi);
    this.struck[voice] = midi;
  }

  /** Falls back to a strike when the voice has nothing to slide from, or the slide is out of its reach. */
  private slide(voice: number, midi: number, ms: number): void {
    const v = this.voices[voice];
    const struck = this.struck[voice];
    if (!v) return;
    if (struck === null || struck === undefined || !canGlide(v) || Math.abs(midi - struck) > v.slideRange) {
      this.strike(voice, midi);
      return;
    }
    v.glide(struck, midi, ms / 1000); // `struck` stays as it is: a later noteOff must name it
  }

  private off(voice: number): void {
    const midi = this.struck[voice];
    if (midi === null || midi === undefined) return;
    this.voices[voice]?.noteOff(midi);
    this.struck[voice] = null;
  }
}
