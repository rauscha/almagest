/**
 * A little room around the voices: a chorus that spreads each voice across the stereo field, and a
 * reverb. It's what lets a pad sound like one. All on Web Audio's own nodes, with nothing in
 * Parallax changed. Off disconnects both, so it costs nothing then.
 */
export type SpaceLevel = "off" | "room" | "hall";
export const SPACES: SpaceLevel[] = ["off", "room", "hall"];

const SETTING: Record<Exclude<SpaceLevel, "off">, { chorus: number; wet: number; seconds: number }> = {
  room: { chorus: 0.3, wet: 0.2, seconds: 1.8 },
  hall: { chorus: 0.4, wet: 0.32, seconds: 3.4 },
};

/** Noise that dies away: a plain, smooth reverb tail, different in each ear. */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const n = Math.round(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  let seed = 0x2545f491;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 4294967296) * 2 - 1;
  };
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) data[i] = rand() * Math.pow(1 - i / n, 2.6);
  }
  return buf;
}

export class Space {
  readonly input: GainNode;
  private chorusIn: GainNode;
  private chorusOut: GainNode;
  private reverb: ConvolverNode;
  private wet: GainNode;
  private impulses = new Map<string, AudioBuffer>();
  level: SpaceLevel = "off";

  constructor(private ctx: BaseAudioContext, output: AudioNode) {
    this.input = ctx.createGain();
    this.input.connect(output); // dry, always

    // Two short delays, each wobbled by its own slow LFO and set to one side.
    this.chorusIn = ctx.createGain();
    this.chorusOut = ctx.createGain();
    this.chorusOut.gain.value = 0;
    [
      { delay: 0.014, rate: 0.27, pan: -0.7 },
      { delay: 0.019, rate: 0.39, pan: 0.7 },
    ].forEach(({ delay, rate, pan }) => {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = delay;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = ctx.createGain();
      depth.gain.value = 0.0025;
      lfo.connect(depth).connect(d.delayTime);
      lfo.start();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      this.chorusIn.connect(d).connect(p).connect(this.chorusOut);
    });
    this.chorusOut.connect(output);

    this.reverb = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.reverb.connect(this.wet).connect(output);
  }

  set(level: SpaceLevel): void {
    if (level === this.level) return;
    if (this.level !== "off") {
      this.input.disconnect(this.chorusIn);
      this.input.disconnect(this.reverb);
      this.chorusOut.disconnect(this.reverb);
    }
    this.level = level;
    if (level === "off") {
      this.chorusOut.gain.value = 0;
      this.wet.gain.value = 0;
      return;
    }
    const s = SETTING[level];
    let ir = this.impulses.get(level);
    if (!ir) {
      ir = impulse(this.ctx, s.seconds);
      this.impulses.set(level, ir);
    }
    this.reverb.buffer = ir;
    this.chorusOut.gain.value = s.chorus;
    this.wet.gain.value = s.wet;
    this.input.connect(this.chorusIn);
    this.input.connect(this.reverb);
    this.chorusOut.connect(this.reverb);
  }
}
