import { describe, expect, it } from "vitest";
import { analyzeNote, chordShare, midiToHz, summarize, verdict, type NoteReport } from "./analysis";

const SR = 48000;
const LEN = Math.round(1.3 * SR);

function additive(partials: [number, number][], decay = 0): Float32Array {
  const x = new Float32Array(LEN);
  for (let i = 0; i < LEN; i++) {
    const t = i / SR;
    let s = 0;
    for (const [hz, amp] of partials) if (hz < SR / 2) s += amp * Math.sin(2 * Math.PI * hz * t);
    x[i] = 0.2 * s * Math.exp(-decay * t);
  }
  return x;
}
const series = (midi: number, amp: (k: number) => number, n = 60): [number, number][] =>
  [...Array(n).keys()].map((i) => [midiToHz(midi) * (i + 1), amp(i + 1)]);

const sine = (m: number) => additive([[midiToHz(m), 1]]);
const saw = (m: number) => additive(series(m, (k) => 1 / k));
const square = (m: number) => additive(series(m, (k) => (k % 2 ? 1 / k : 0)));
// A narrow pulse, the classic chiptune wave: strong overtones, almost evenly loud.
const narrowPulse = (m: number) => additive(series(m, (k) => Math.abs(Math.sin((Math.PI * k) / 8)) / k * 1.2 + 0.0));
const bell = (m: number) => {
  const f = midiToHz(m);
  return additive([[f, 0.5], [f * 2.76, 1], [f * 5.4, 0.8], [f * 8.93, 0.6], [f * 13.3, 0.4]]);
};
function noise(): Float32Array {
  let seed = 12345;
  const x = new Float32Array(LEN);
  for (let i = 0; i < LEN; i++) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    x[i] = (seed / 4294967296 - 0.5) * 0.4;
  }
  return x;
}

const NOTES = [43, 57, 60, 64, 69, 76];
const judge = (make: (m: number) => Float32Array, chord: number) => {
  const notes: NoteReport[] = NOTES.map((m) => analyzeNote(make(m), SR, m));
  return verdict(summarize(notes, chord));
};

describe("analyzeNote on signals whose answer is known", () => {
  it("a sine is all fundamental", () => {
    const r = analyzeNote(sine(60), SR, 60);
    expect(r.harmonicity).toBeGreaterThan(0.99);
    expect(r.rootShare).toBeGreaterThan(0.99);
    expect(r.fundamental).toBeGreaterThan(0.99);
    expect(r.strongest).toBe(1);
    // A 0.4 s window at middle C resolves to a few cents, which is all the 30-cent bar needs.
    expect(Math.abs(r.tuningCents)).toBeLessThan(6);
  });
  it("a sawtooth has a root share of about 0.8, as the bar assumes", () => {
    const r = analyzeNote(saw(60), SR, 60);
    expect(r.harmonicity).toBeGreaterThan(0.97);
    expect(r.rootShare).toBeGreaterThan(0.7);
    expect(r.rootShare).toBeLessThan(0.9);
  });
  it("a narrow pulse loses the root to its overtones", () => {
    const pulse = analyzeNote(narrowPulse(60), SR, 60);
    const plain = analyzeNote(saw(60), SR, 60);
    expect(pulse.harmonicity).toBeGreaterThan(0.95); // still perfectly periodic...
    expect(pulse.rootShare).toBeLessThan(plain.rootShare); // ...but less of it is the claimed note
  });
  it("noise is spread across every pitch class and off the harmonics", () => {
    const r = analyzeNote(noise(), SR, 60);
    expect(r.rootShare).toBeLessThan(0.15);
    expect(r.harmonicity).toBeLessThan(0.6);
  });
  it("an inharmonic bell is off the harmonics", () => {
    expect(analyzeNote(bell(60), SR, 60).harmonicity).toBeLessThan(0.6);
  });
  it("a note a quarter tone flat reads as out of tune", () => {
    const r = analyzeNote(additive([[midiToHz(59.6), 1]]), SR, 60);
    expect(r.tuningCents).toBeLessThan(-25);
  });
  it("the right pitch but the wrong note fails", () => {
    const r = analyzeNote(sine(67), SR, 60); // G when C was asked for
    expect(r.rootShare).toBeLessThan(0.05);
  });
  it("a decaying note reads as not holding, and a steady one as holding", () => {
    expect(analyzeNote(sine(60), SR, 60).holds).toBeGreaterThan(0.95);
    expect(analyzeNote(additive([[midiToHz(60), 1]], 6), SR, 60).holds).toBeLessThan(0.05);
  });
  it("silence reads as silent", () => {
    expect(analyzeNote(new Float32Array(LEN), SR, 60).silent).toBe(true);
  });
});

describe("the attack counts", () => {
  /** Loud noise that's gone in 150 ms, over a faint tone that rings on: how a snare works. */
  function snare(m: number): Float32Array {
    const tail = sine(m);
    const hiss = noise();
    const x = new Float32Array(LEN);
    for (let i = 0; i < LEN; i++) {
      const t = i / SR;
      x[i] = hiss[i] * 3 * Math.exp(-t * 25) + tail[i] * 0.05 * Math.exp(-t * 3);
    }
    return x;
  }
  it("a noisy attack with a tonal tail is not tonal", () => {
    const r = analyzeNote(snare(60), SR, 60);
    expect(r.harmonicity).toBeLessThan(0.75);
    expect(r.rootShare).toBeLessThan(0.45);
    expect(judge(snare, 0.3).keep).toBe(false);
  });
  it("a brief bright attack on a tonal note doesn't sink it", () => {
    const body = saw(60);
    const x = new Float32Array(LEN);
    const bright = additive(series(60, (k) => (k > 4 ? 2 / Math.sqrt(k) : 0)));
    for (let i = 0; i < LEN; i++) x[i] = body[i] + bright[i] * Math.exp((-i / SR) * 60);
    const r = analyzeNote(x, SR, 60);
    expect(r.harmonicity).toBeGreaterThan(0.9);
    expect(r.rootShare).toBeGreaterThan(0.5);
  });
  it("what a sawtooth chord scores, which sets the chord bar", () => {
    const m = [60, 64, 67, 72, 48];
    const partials = m.flatMap((n) => series(n, (k) => 1 / k, 30));
    const share = chordShare(additive(partials), SR, [0, 4, 7]);
    expect(share).toBeGreaterThan(0.72); // the bar is 0.7, just under this
    expect(share).toBeLessThan(0.95);
  });
});

describe("chordShare", () => {
  const triad = additive([[midiToHz(60), 1], [midiToHz(64), 1], [midiToHz(67), 1]]);
  it("finds a clean triad's notes", () => {
    expect(chordShare(triad, SR, [0, 4, 7])).toBeGreaterThan(0.98);
  });
  it("tells a major chord from the same notes judged as minor", () => {
    expect(chordShare(triad, SR, [0, 3, 7])).toBeLessThan(0.7);
  });
});

describe("the verdict", () => {
  it("keeps the plain tonal waves", () => {
    expect(judge(sine, 0.95).keep).toBe(true);
    expect(judge(saw, 0.85).keep).toBe(true);
    expect(judge(square, 0.85).keep).toBe(true);
  });
  it("drops noise and bells as atonal", () => {
    const n = judge(() => noise(), 0.3);
    expect(n.keep).toBe(false);
    expect(n.why.join()).toMatch(/atonal/);
    expect(judge(bell, 0.4).why.join()).toMatch(/atonal/);
  });
  it("explains a chord that's lost its notes", () => {
    expect(judge(saw, 0.5).why.join()).toMatch(/chord/);
  });

  const clean = {
    harmonicity: 0.98, rootShare: 0.8, worstRootShare: 0.7, fundamental: 0.6, tuningCents: 3, holds: 0.9, chord: 0.9,
  };
  it("keeps a clean sound, whether it holds or decays naturally", () => {
    expect(verdict(clean).tier).toBe("keep");
    expect(verdict({ ...clean, holds: 0.08 }).tier).toBe("keep"); // a piano-like decay is fine
  });
  it("sends close misses on attack-sensitive measures to the ear", () => {
    expect(verdict({ ...clean, harmonicity: 0.64 }).tier).toBe("listen");
    expect(verdict({ ...clean, chord: 0.66 }).tier).toBe("listen");
    expect(verdict({ ...clean, harmonicity: 0.64, chord: 0.66 }).tier).toBe("listen");
  });
  it("drops clear misses", () => {
    expect(verdict({ ...clean, harmonicity: 0.5 }).tier).toBe("drop");
    expect(verdict({ ...clean, chord: 0.5 }).tier).toBe("drop");
  });
  it("never lets overtones, a bad note, tuning or dying away through as close", () => {
    expect(verdict({ ...clean, rootShare: 0.4 }).tier).toBe("drop");
    expect(verdict({ ...clean, worstRootShare: 0.07 }).why.join()).toMatch(/one note/);
    expect(verdict({ ...clean, worstRootShare: 0.07 }).tier).toBe("drop");
    expect(verdict({ ...clean, tuningCents: 42 }).tier).toBe("drop");
    expect(verdict({ ...clean, holds: 0 }).why.join()).toMatch(/dies away/);
    expect(verdict({ ...clean, holds: 0 }).tier).toBe("drop");
    expect(verdict({ ...clean, harmonicity: 0.64, holds: 0 }).tier).toBe("drop");
  });
});
