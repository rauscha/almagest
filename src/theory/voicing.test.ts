import { describe, expect, it } from "vitest";
import { Chord as TonalChord, Note } from "@tonaljs/tonal";
import { chordOf, circleChords } from "./keyLens";
import {
  BASS_RANGE, candidates, chooseBass, keepOrder, movement, REGISTER, score, SPREADS, voice, voicesOf,
  type Spread, type Voiced,
} from "./voicing";

const pc = (name: string) => Note.chroma(name)!;
const midi = (name: string) => Note.midi(name)!;
const notes = (s: string) => s.split(" ").map(midi);

/** Chord tones from an independent source, most worth keeping first. */
function fromSymbol(symbol: string) {
  const c = TonalChord.get(symbol);
  expect(c.empty, symbol).toBe(false);
  const [root, third, fifth, seventh, ...extensions] = c.notes.map(pc);
  return { root, tones: keepOrder({ root, third, fifth, seventh, extensions }) };
}
const held = (upper: string): Voiced => ({ upper: notes(upper), bass: 48 });
const moveCost = (from: string, symbol: string, n: number) => {
  const prev = held(from);
  return movement(prev.upper, voice(fromSymbol(symbol), prev, "close", n).upper);
};

describe("the voice-leading figures", () => {
  it("Dm7 as D4 F4 A4 C5 goes to G7 as D4 F4 G4 B4, a cost of 3", () => {
    const next = voice(fromSymbol("G7"), held("D4 F4 A4 C5"), "close");
    expect(next.upper).toEqual(notes("D4 F4 G4 B4"));
    expect(movement(notes("D4 F4 A4 C5"), next.upper)).toBe(3);
  });
  it("with 3 upper voices from C4 E4 G4", () => {
    expect(moveCost("C4 E4 G4", "Am", 3)).toBe(2);
    expect(moveCost("C4 E4 G4", "Em", 3)).toBe(1);
    expect(moveCost("C4 E4 G4", "Cm", 3)).toBe(1);
    expect(moveCost("C4 E4 G4", "E", 3)).toBe(2);
  });
  it("with 4, from C4 E4 G4 C5, C to E costs 3, because the doubled note moves too", () => {
    expect(moveCost("C4 E4 G4 C5", "E", 4)).toBe(3);
  });
});

describe("which notes go when there are too many", () => {
  it("a 9th chord on 4 voices has no 5th", () => {
    const c9 = keepOrder({ root: pc("C"), third: pc("E"), fifth: pc("G"), seventh: pc("Bb"), extensions: [pc("D")] });
    for (const spread of SPREADS) {
      const v = voice({ root: pc("C"), tones: c9 }, null, spread);
      const got = new Set(v.upper.map((m) => m % 12));
      expect(got, spread).toEqual(new Set([pc("C"), pc("E"), pc("Bb"), pc("D")]));
    }
  });
  it("a 7th chord on 3 voices keeps root, 3rd and 7th", () => {
    const v = voice(fromSymbol("G7"), null, "close", 3);
    expect(new Set(v.upper.map((m) => m % 12))).toEqual(new Set([pc("G"), pc("B"), pc("F")]));
  });
});

const everyChord = () => [...circleChords({ col: 0, mode: "major" })];
const request = (c: { root: number; pcs: number[] }) => ({ root: c.root, tones: c.pcs });

describe("every chord, spread and voice count", () => {
  for (const spread of SPREADS) {
    for (const n of [3, 4, 5, 6]) {
      it(`${spread} on ${n} voices has somewhere to go, and every placement is valid`, () => {
        const { lo, hi } = REGISTER[spread];
        for (const c of everyChord()) {
          const list = candidates(c.pcs, spread, n);
          expect(list.length, c.name).toBeGreaterThan(0);
          for (const v of list) {
            expect(v).toHaveLength(n);
            for (let i = 1; i < n; i++) expect(v[i], `${c.name} ${v}`).toBeGreaterThan(v[i - 1]);
            expect(v[0]).toBeGreaterThanOrEqual(lo);
            expect(v[n - 1]).toBeLessThanOrEqual(hi);
            for (const pcWanted of c.pcs) expect(v.some((m) => m % 12 === pcWanted), `${c.name} ${v}`).toBe(true);
            for (const m of v) expect(c.pcs).toContain(m % 12);
          }
        }
      });
    }
  }
});

describe("ready for the alterations to come", () => {
  const SUFFIXES = ["7", "maj7", "m7", "dim7", "sus2", "sus4", "add9", "9", "m9", "7sus4", "maj9"];
  const ROOTS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  for (const spread of SPREADS) {
    for (const n of [3, 4, 5, 6]) {
      it(`${spread} on ${n} voices can place every 7th, 9th and sus chord`, () => {
        for (const root of ROOTS) {
          for (const suffix of SUFFIXES) {
            const c = TonalChord.get(`${root}${suffix}`);
            expect(c.empty, `${root}${suffix}`).toBe(false);
            const pcs = c.notes.map(pc);
            expect(candidates(pcs, spread, n).length, `${root}${suffix} ${spread} ${n}`).toBeGreaterThan(0);
          }
        }
      });
    }
  }
});

describe("what each spread means", () => {
  const span = (v: number[]) => v[v.length - 1] - v[0];
  it("close keeps every upper voice within an octave", () => {
    for (const c of everyChord()) for (const v of candidates(c.pcs, "close")) expect(span(v)).toBeLessThanOrEqual(12);
  });
  it("open is drop-2: raise the lowest voice an octave and it's the second from the top of a close voicing", () => {
    for (const c of everyChord()) {
      for (const v of candidates(c.pcs, "open")) {
        const raised = v[0] + 12;
        const stack = [...v.slice(1), raised].sort((a, b) => a - b);
        expect(stack[2], `${c.name} ${v}`).toBe(raised);
        expect(span(stack)).toBeLessThanOrEqual(12);
      }
    }
  });
  it("open sounds like the example: C drops to G3 C4 E4 C5", () => {
    expect(candidates(chordOf({ ring: "maj", col: 0 }, { col: 0, mode: "major" }).pcs, "open")).toContainEqual(notes("G3 C4 E4 C5"));
  });
  it("wide spreads across at least two octaves", () => {
    for (const c of everyChord()) for (const v of candidates(c.pcs, "wide")) expect(span(v)).toBeGreaterThanOrEqual(24);
  });
});

function randomRun(seed: number, count: number, spread: Spread | null, n = 4) {
  let s = seed;
  const next = (k: number) => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return Math.floor((s / 4294967296) * k);
  };
  const chords = everyChord();
  const out: { from: Voiced | null; to: Voiced; spread: Spread; pcs: number[] }[] = [];
  let prev: Voiced | null = null;
  for (let i = 0; i < count; i++) {
    const c = chords[next(chords.length)];
    const sp: Spread = spread ?? SPREADS[next(3)];
    const to = voice(request(c), prev, sp, n);
    out.push({ from: prev, to, spread: sp, pcs: c.pcs });
    prev = to;
  }
  return out;
}

describe("over long random runs", () => {
  for (const spread of [...SPREADS, null]) {
    const label = spread ?? "changing spreads";
    it(`${label}: voices never cross, and the bass stays under them`, () => {
      for (const { to } of randomRun(7, 1000, spread)) {
        for (let i = 1; i < to.upper.length; i++) expect(to.upper[i]).toBeGreaterThan(to.upper[i - 1]);
        expect(to.bass).toBeLessThan(to.upper[0]);
      }
    });
    it(`${label}: nothing valid would have moved less`, () => {
      for (const { from, to, spread: sp, pcs } of randomRun(11, 1000, spread)) {
        if (!from) continue;
        const best = Math.min(...candidates(pcs, sp).map((v) => score(from.upper, v)));
        expect(score(from.upper, to.upper)).toBe(best);
      }
    });
    it(`${label}: the voicing never wanders out of its register`, () => {
      for (const { to, spread: sp } of randomRun(13, 1000, spread)) {
        const { center, drift } = REGISTER[sp];
        const avg = to.upper.reduce((a, b) => a + b, 0) / to.upper.length;
        expect(Math.abs(avg - center)).toBeLessThanOrEqual(drift);
      }
    });
  }
  it("smooth is really smoother: the average move is small", () => {
    const run = randomRun(17, 1000, "close").filter((r) => r.from);
    const avg = run.reduce((sum, r) => sum + movement(r.from!.upper, r.to.upper), 0) / run.length;
    expect(avg).toBeLessThan(10); // four voices across any two chords on the circle
  });
  it("a chord pressed again keeps its voicing", () => {
    for (const spread of SPREADS) {
      const c = request(chordOf({ ring: "min", col: 3 }, { col: 0, mode: "major" }));
      const first = voice(c, null, spread);
      expect(voice(c, first, spread)).toEqual(first);
    }
  });
  it("keeps the top note still whenever that costs no more", () => {
    let ties = 0;
    for (const spread of SPREADS) {
      for (const { from, to, spread: sp, pcs } of randomRun(23, 1000, spread)) {
        if (!from) continue;
        const best = score(from.upper, to.upper);
        const top = from.upper[3];
        const tied = candidates(pcs, sp).filter((v) => score(from.upper, v) === best);
        if (tied.length > 1 && tied.some((v) => v[3] === top) && tied.some((v) => v[3] !== top)) ties++;
        if (tied.some((v) => v[3] === top)) expect(to.upper[3]).toBe(top);
      }
    }
    expect(ties, "this test needs real ties to mean anything").toBeGreaterThan(0);
  });
  it("a first chord starts near the middle of the register, not at an edge", () => {
    expect(voicesOf(voice(fromSymbol("C"), null, "close"))).toEqual([60, 64, 67, 72, 48]);
  });
});

describe("the bass", () => {
  it("plays the root in its own register", () => {
    for (let root = 0; root < 12; root++) {
      const b = chooseBass(root, null);
      expect(b % 12).toBe(root);
      expect(b).toBeGreaterThanOrEqual(BASS_RANGE.lo);
      expect(b).toBeLessThanOrEqual(BASS_RANGE.hi);
    }
  });
  it("takes the nearer octave when there's a choice", () => {
    expect(chooseBass(pc("C"), midi("A2"))).toBe(midi("C3"));
    expect(chooseBass(pc("C"), midi("D2"))).toBe(midi("C2"));
  });
});

describe("speed", () => {
  it("choosing a voicing stays far under the 2 ms budget, even on six voices", () => {
    const chords = everyChord().map(request);
    let prev: Voiced | null = null;
    for (const c of chords) voice(c, null, "wide", 6); // first use fills the cache
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) prev = voice(chords[i % chords.length], prev, "wide", 6);
    expect((performance.now() - t0) / 1000).toBeLessThan(0.5);
  });
  it("even an uncached chord is under budget", () => {
    const t0 = performance.now();
    voice({ root: pc("C#"), tones: [1, 5, 11, 3, 8] }, null, "wide", 6);
    expect(performance.now() - t0).toBeLessThan(2);
  });
});
