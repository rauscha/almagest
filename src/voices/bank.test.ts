import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VoiceBank } from "./bank";
import { CATALOG, DROPPED_BY_EAR, engineKnobs, engineLevel, engineModelIndex, MULTI, PAD, PAD_SHAPE, RECORDED } from "./catalog";
import { existsSync } from "node:fs";
import { INSTRUMENTS, nearestRoot, PIANO_ROOTS, rateFor } from "./recorded";
import type { ISynthEngine } from "../../vendor/parallax/src/audio/types";

function fakeEngine(id: string, log: string[], slideRange: number | null = 36) {
  const glides = slideRange === null ? {} : {
    slideRange,
    glide: (struck: number, m: number, s: number) => log.push(`${id} glide ${struck}>${m} ${s}s`),
  };
  return {
    ...glides,
    output: { connect: () => log.push(`${id} connect`) },
    init: async () => void log.push(`${id} init`),
    dispose: async () => void log.push(`${id} dispose`),
    noteOn: (m: number) => log.push(`${id} on ${m}`),
    noteOff: (m: number) => log.push(`${id} off ${m}`),
    allNotesOff: () => log.push(`${id} all`),
    setParameter: (p: string, v: number) => log.push(`${id} ${p} ${v}`),
  } as unknown as ISynthEngine;
}

const fakeGain = () => {
  const gain = { value: 0, setTargetAtTime: (v: number) => void (gain.value = v) };
  return { gain, connect: () => {} };
};
const fakeCtx = { createGain: fakeGain, currentTime: 0 } as unknown as AudioContext;

async function rig() {
  const log: string[] = [];
  let n = 0;
  const bank = new VoiceBank(fakeCtx, () => fakeEngine(`v${n++}`, log), (_e, p) => p + 100, {} as AudioNode);
  await bank.useEngine("multi", 3);
  log.length = 0;
  return { bank, log };
}

describe("voice bank", () => {
  it("builds five voices once, each set to the model", async () => {
    const log: string[] = [];
    let n = 0;
    const bank = new VoiceBank(fakeCtx, () => fakeEngine(`v${n++}`, log), (_e, p) => p + 100, {} as AudioNode);
    await bank.useEngine("multi", 3);
    expect(log.filter((l) => l.endsWith("init"))).toHaveLength(5);
    expect(log.filter((l) => l.endsWith("model 103"))).toHaveLength(5);
  });
  it("sends commands only to the voice named", async () => {
    const { bank, log } = await rig();
    bank.apply([{ kind: "on", voice: 1, midi: 63 }]);
    expect(log).toEqual(["v1 on 63"]);
  });
  it("noteOff names the note that voice struck, or the engine would ignore it", async () => {
    const { bank, log } = await rig();
    bank.apply([{ kind: "on", voice: 2, midi: 67 }, { kind: "on", voice: 2, midi: 69 }]);
    log.length = 0;
    bank.apply([{ kind: "off", voice: 2 }]);
    expect(log).toEqual(["v2 off 69"]);
  });
  it("allOff only touches voices that are sounding, and only once", async () => {
    const { bank, log } = await rig();
    bank.apply([{ kind: "on", voice: 0, midi: 60 }, { kind: "on", voice: 4, midi: 48 }]);
    log.length = 0;
    bank.apply([{ kind: "allOff" }]);
    expect(log).toEqual(["v0 off 60", "v4 off 48"]);
    log.length = 0;
    bank.apply([{ kind: "allOff" }]);
    expect(log).toEqual([]);
  });
  it("a slide glides, and doesn't strike", async () => {
    const { bank, log } = await rig();
    bank.apply([{ kind: "on", voice: 1, midi: 60 }]);
    log.length = 0;
    bank.apply([{ kind: "slide", voice: 1, midi: 65, ms: 80 }]);
    expect(log).toEqual(["v1 glide 60>65 0.08s"]);
  });
  it("after a slide, noteOff names the note originally struck", async () => {
    const { bank, log } = await rig();
    bank.apply([{ kind: "on", voice: 2, midi: 67 }, { kind: "slide", voice: 2, midi: 69, ms: 80 }, { kind: "slide", voice: 2, midi: 71, ms: 80 }]);
    log.length = 0;
    bank.apply([{ kind: "allOff" }]);
    expect(log).toEqual(["v2 off 67"]);
  });
  it("a second slide is measured from the struck note, not the last slide", async () => {
    const { bank, log } = await rig();
    bank.apply([{ kind: "on", voice: 0, midi: 60 }, { kind: "slide", voice: 0, midi: 62, ms: 80 }, { kind: "slide", voice: 0, midi: 64, ms: 40 }]);
    expect(log.at(-1)).toBe("v0 glide 60>64 0.04s");
  });
  it("a slide past the engine's reach strikes instead", async () => {
    const log: string[] = [];
    const bank = new VoiceBank(fakeCtx, () => fakeEngine("v", log, 3), (_e, p) => p, {} as AudioNode);
    await bank.useEngine("fm", 0);
    log.length = 0;
    bank.apply([{ kind: "on", voice: 0, midi: 60 }, { kind: "slide", voice: 0, midi: 63, ms: 80 }]);
    expect(log).toEqual(["v on 60", "v glide 60>63 0.08s"]);
    log.length = 0;
    bank.apply([{ kind: "slide", voice: 0, midi: 64, ms: 80 }]);
    expect(log).toEqual(["v on 64"]);
    log.length = 0;
    bank.apply([{ kind: "allOff" }]); // and the strike is what noteOff has to name now
    expect(log).toEqual(["v off 64"]);
  });
  it("a slide on a silent voice strikes, or nothing would be heard", async () => {
    const { bank, log } = await rig();
    bank.apply([{ kind: "slide", voice: 3, midi: 60, ms: 80 }]);
    expect(log).toEqual(["v3 on 60"]);
  });
  it("an engine that can't glide strikes", async () => {
    const log: string[] = [];
    const bank = new VoiceBank(fakeCtx, () => fakeEngine("v", log, null), (_e, p) => p, {} as AudioNode);
    await bank.useEngine("fm", 0);
    log.length = 0;
    bank.apply([{ kind: "on", voice: 0, midi: 60 }, { kind: "slide", voice: 0, midi: 62, ms: 80 }]);
    expect(log).toEqual(["v on 60", "v on 62"]);
  });
  it("is safe to play before the voices exist", () => {
    const bank = new VoiceBank(fakeCtx, () => fakeEngine("x", []), (_e, p) => p, {} as AudioNode);
    expect(() =>
      bank.apply([{ kind: "on", voice: 0, midi: 60 }, { kind: "slide", voice: 0, midi: 62, ms: 80 }, { kind: "allOff" }]),
    ).not.toThrow();
  });
  it("disposes the old voices when the engine changes", async () => {
    const { bank, log } = await rig();
    await bank.useEngine("fm", 0);
    expect(log.filter((l) => l.endsWith("dispose"))).toHaveLength(5);
    expect(log.filter((l) => l.endsWith("init"))).toHaveLength(5);
  });
  it("sets each engine's level on the shared bus", async () => {
    const bus = fakeGain();
    const ctx = { createGain: () => bus, currentTime: 0 } as unknown as AudioContext;
    const bank = new VoiceBank(ctx, () => fakeEngine("v", []), (_e, p) => p, {} as AudioNode, (e) => (e === "fm" ? 2 : 1));
    await bank.useEngine("multi", 0);
    const plain = bus.gain.value;
    await bank.useEngine("fm", 0);
    expect(bus.gain.value).toBeCloseTo(plain * 2);
  });
  it("a sound's knobs reach every voice, with the model", async () => {
    const log: string[] = [];
    let n = 0;
    const knobs = (_e: string, p: number) => (p === 1 ? { cutoff: 0.5, attack: 0.4 } : { cutoff: 1, attack: 0.01 });
    const bank = new VoiceBank(fakeCtx, () => fakeEngine(`v${n++}`, log), (_e, p) => p, {} as AudioNode, () => 1, knobs);
    await bank.useEngine("pad", 1);
    expect(log.filter((l) => l.endsWith("cutoff 0.5"))).toHaveLength(5);
    log.length = 0;
    bank.useModel(0);
    expect(log.filter((l) => l.endsWith("cutoff 1"))).toHaveLength(5);
    expect(log.filter((l) => l.endsWith("attack 0.01"))).toHaveLength(5);
    expect(engineKnobs("pad", 0)).toEqual(PAD[0].knobs);
    expect(engineModelIndex("pad", 2)).toBe(PAD[2].index);
  });
  it("model changes reach every voice", async () => {
    const { bank, log } = await rig();
    bank.useModel(1);
    expect(log.filter((l) => l.endsWith("model 101"))).toHaveLength(5);
  });
});

const MULTI_ENTRY = CATALOG.find((e) => e.id === "multi")!;

describe("catalog", () => {
  it("offers the chord engines under the app's own labels", () => {
    expect(CATALOG.map((e) => e.label)).toEqual(["Pad synth", "Multi-model", "Recorded"]); // Six-op FM went
  });
  it("the pads are there, and Wide Saw is the multi-model's detuned pair", () => {
    expect(CATALOG.find((e) => e.id === "pad")!.models).toEqual(["Soft Saw", "Dark Saw", "Warm Sine", "Slow Sweep", "Long Sweep"]);
    expect(MULTI_ENTRY.models).toContain("Wide Saw");
    const wide = MULTI.find((m) => m.name === "Wide Saw")!;
    expect(wide.index).toBe(8); // the engine's virtual-analog model
    expect(wide.knobs.harmonics).toBeGreaterThan(0.5); // the detune, past the default
  });
  it("every sound on an engine sets the same knobs, so none inherits another's", () => {
    for (const list of [MULTI, PAD]) {
      const keys = Object.keys(list[0].knobs).sort().join();
      for (const p of list) expect(Object.keys(p.knobs).sort().join(), p.name).toBe(keys);
    }
  });
  it("a pad is slow to start and slow to let go, and filtered", () => {
    for (const p of PAD) {
      expect(p.knobs.attack, p.name).toBeGreaterThanOrEqual(0.2);
      expect(p.knobs.release, p.name).toBeGreaterThanOrEqual(1);
      expect(p.knobs.cutoff, p.name).toBeLessThan(1);
      // A sweep stays slow and stays a filter's: it never opens fully or shuts to nothing.
      expect(p.knobs.sweepRate, p.name).toBeLessThanOrEqual(0.2);
      expect(p.knobs.cutoff + p.knobs.sweepDepth, p.name).toBeLessThan(0.8);
      expect(p.knobs.cutoff - p.knobs.sweepDepth, p.name).toBeGreaterThan(0.35);
    }
    expect(PAD.filter((p) => p.knobs.sweepDepth > 0).map((p) => p.name)).toEqual(["Slow Sweep", "Long Sweep"]);
  });
  it("maps its list to the engine's real indices", () => {
    expect(engineModelIndex("multi", MULTI_ENTRY.models.indexOf("Wide Saw"))).toBe(8);
    expect(engineModelIndex("pad", PAD.findIndex((p) => p.name === "Long Sweep"))).toBe(PAD_SHAPE.saw);
  });
  it("offers exactly what the spectral survey passed, less what listening dropped", () => {
    const rows: { engine: string; name: string; tier: string }[] = JSON.parse(
      readFileSync(resolve(__dirname, "../../tools/survey/results.json"), "utf8"),
    );
    // The recorded instruments aren't synthesis to survey: they're judged by ear.
    for (const entry of CATALOG.filter((e) => e.id !== "recorded")) {
      const passed = rows
        .filter((r) => r.engine === entry.id && r.tier !== "drop" && !DROPPED_BY_EAR.includes(r.name))
        .map((r) => r.name);
      expect([...entry.models].sort()).toEqual([...passed].sort());
    }
  });
  it("leaves out the sounds dropped by ear", () => {
    const all = CATALOG.flatMap((e) => e.models);
    for (const gone of DROPPED_BY_EAR) expect(all).not.toContain(gone);
    expect(MULTI_ENTRY.models).toContain("Wavetable");
  });
  it("gives every recorded note a file, and keeps the piano from sliding", () => {
    expect(RECORDED.map((s) => INSTRUMENTS[s.index].dir)).toEqual(["piano", "strings"]);
    for (const { dir, roots } of INSTRUMENTS) {
      for (const root of roots) expect(existsSync(resolve(__dirname, `../../public/samples/${dir}/${root}.ogg`)), `${dir} ${root}`).toBe(true);
    }
    expect(INSTRUMENTS[0].slideRange).toBe(0);
    expect(INSTRUMENTS[1].slideRange).toBeGreaterThan(24);
  });
  it("plays each key from the nearest recording, at the right pitch", () => {
    expect(nearestRoot(PIANO_ROOTS, 60)).toBe(60);
    expect(nearestRoot(PIANO_ROOTS, 61)).toBe(60);
    expect(nearestRoot(PIANO_ROOTS, 62)).toBe(63);
    expect(rateFor(60, 72)).toBeCloseTo(2);
    expect(rateFor(60, 60)).toBe(1);
  });
  it("leaves out what you named: chiptune and the atonal sounds", () => {
    const all = CATALOG.flatMap((e) => e.models);
    for (const gone of ["Chiptune", "Chords", "Swarm", "Analog Snare", "Filtered Noise", "Clank", "Bronze Gong"]) {
      expect(all).not.toContain(gone);
    }
  });
});

describe("the app's own sound", () => {
  it("goes quiet and comes back to its own level", () => {
    const ramps: number[] = [];
    const bus = { gain: { value: 0, setTargetAtTime: (v: number) => ramps.push(v) }, connect: () => {} };
    const ctx = { createGain: () => bus, currentTime: 0 } as unknown as AudioContext;
    const bank = new VoiceBank(ctx, () => { throw new Error("no voices here"); }, () => 0, {} as AudioNode, () => 0.5);
    bank.setOwnSound(false);
    bank.setOwnSound(true);
    expect(ramps).toEqual([0, 0.275]);
  });
});

describe("a sound's own trim", () => {
  it("lifts the recordings to sit with the other sounds, and leaves the multi-model list alone", () => {
    expect(engineLevel("recorded", 0)).toBeCloseTo(1.7);
    expect(engineLevel("recorded", 1)).toBeCloseTo(1.6);
    for (const position of MULTI.keys()) expect(engineLevel("multi", position)).toBe(1);
  });
});
