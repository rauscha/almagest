import { describe, expect, it } from "vitest";
import { createCore, type Sound } from "./core";
import type { Alteration, ChordRef, Intent } from "./contract";
import type { VoiceCommand } from "./reduce";
import { HOLD_MS, LONG_MS } from "./gestures";

function rig() {
  const sent: VoiceCommand[][] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const holds: { fn: () => void; ms: number }[] = [];
  const longs: { fn: () => void; ms: number }[] = [];
  const sound: Sound = { apply: (c) => void (c.length && sent.push(c)), useEngine: () => {}, useModel: () => {} };
  const core = createCore({
    catalog: [{ id: "multi", label: "Multi-model", models: ["a", "b"] }],
    sound,
    setTimer: (fn, ms) => void (ms === HOLD_MS ? holds : ms === LONG_MS ? longs : timers).push({ fn, ms }),
  });
  const touch = (phase: "down" | "up" | "cancel" | "move", pointer: number, ref: ChordRef | null = null): Intent => ({
    type: "touch", phase, pointer, ref, r: 0, theta: 0, time: 0,
  });
  return {
    core, sent, timers, holds, longs,
    fireHolds: () => holds.splice(0).forEach((t) => t.fn()),
    fireLongs: () => longs.splice(0).forEach((t) => t.fn()),
    press: (ref: ChordRef, pointer = 1) => core.send(touch("down", pointer, ref)),
    lift: (pointer = 1) => core.send(touch("up", pointer)),
    cancel: (pointer = 1) => core.send(touch("cancel", pointer)),
    move: (pointer = 1) => core.send(touch("move", pointer)),
    fireTimers: () => timers.splice(0).forEach((t) => t.fn()),
  };
}
const C: ChordRef = { ring: "maj", col: 0 };
const Cm: ChordRef = { ring: "min", col: 9 };
const G: ChordRef = { ring: "maj", col: 1 };
const notes = (cmds: VoiceCommand[]) => cmds.flatMap((c) => (c.kind === "on" ? [c.midi] : []));
const SLID = (voice: number, midi: number, ms = 80): VoiceCommand => ({
  kind: "slide", voice, midi, ms,
});

describe("touch to sound", () => {
  it("a press produces its sound immediately", () => {
    const r = rig();
    r.press(C);
    expect(notes(r.sent[0])).toEqual([60, 64, 67, 72, 48]);
  });
  it("a common tone gets no command when the chord changes", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.press(Cm);
    // C4 E4 G4 C5 over C3 to C4 E♭4 G4 C5 over C3: only E moves.
    expect(r.sent[1]).toEqual([SLID(1, 63)]);
  });
  it("movement never changes the chord", () => {
    const r = rig();
    r.press(C);
    const before = r.core.state.get().current;
    r.move();
    expect(r.core.state.get().current).toBe(before);
    expect(r.sent).toHaveLength(1);
  });
  it("the current chord shows in the views", () => {
    const r = rig();
    r.press(G);
    expect(r.core.views.readout.get()).toMatchObject({ name: "G", numeral: "V", relation: "Dominant" });
    expect(r.core.views.circle.get().current).toEqual(G);
  });
  it("names an outside chord as outside", () => {
    const r = rig();
    r.press({ ring: "maj", col: 7 });
    expect(r.core.views.readout.get()).toMatchObject({ name: "D♭", numeral: "♭II", relation: "Outside the key" });
  });
  it("ignores a release from a finger that never pressed a chord", () => {
    const r = rig();
    r.press(C, 1);
    r.lift(2);
    expect(r.timers).toHaveLength(0);
    expect(r.core.state.get().fingers).toEqual([1]);
  });
  it("with two fingers, the newest chord wins and sound continues until the last lift", () => {
    const r = rig();
    r.press(C, 1);
    r.press(G, 2);
    expect(r.core.state.get().current?.ref).toEqual(G);
    r.lift(2);
    expect(r.timers).toHaveLength(0);
    r.lift(1);
    expect(r.timers).toHaveLength(1);
  });
});

describe("lifting a finger", () => {
  it("rings for the set time, then stops", () => {
    const r = rig();
    r.press(C);
    r.lift();
    expect(r.timers[0].ms).toBe(1000);
    expect(r.sent).toHaveLength(1);
    r.fireTimers();
    expect(r.sent[1]).toEqual([{ kind: "allOff" }]);
    expect(r.core.state.get().sounding).toBeNull();
  });
  it("a press in the ring time connects, and the old ring can't cut it off", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.press(Cm);
    expect(r.sent[1]).toEqual([SLID(1, 63)]);
    r.fireTimers();
    expect(r.sent).toHaveLength(2);
    expect(r.core.state.get().sounding).not.toBeNull();
  });
  it("an old ring timer can't cut off a chord played and lifted after it", () => {
    const r = rig();
    r.press(C);
    r.lift();
    const stale = r.timers.splice(0);
    r.press(Cm);
    r.lift();
    stale.forEach((t) => t.fn());
    expect(r.core.state.get().sounding).not.toBeNull();
    expect(r.sent).toHaveLength(2);
    r.fireTimers(); // the chord's own ring still ends it
    expect(r.core.state.get().sounding).toBeNull();
  });
  it("after the ring ends, the next chord strikes every voice", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.fireTimers();
    r.press(Cm);
    expect(notes(r.sent[2])).toHaveLength(5);
  });
  it("stops at once when ring-on is off", () => {
    const r = rig();
    r.core.send({ type: "ringChanged", ms: 0 });
    r.press(C);
    r.lift();
    expect(r.sent[1]).toEqual([{ kind: "allOff" }]);
    expect(r.timers).toHaveLength(0);
  });
  it("with Sustain on, a lift doesn't stop the chord", () => {
    const r = rig();
    r.core.send({ type: "sustainToggled" });
    r.press(C);
    r.lift();
    r.fireTimers();
    expect(r.sent).toHaveLength(1);
    expect(r.core.views.circle.get().sustain).toBe(true);
  });
  it("switching Sustain off with no finger down stops the chord", () => {
    const r = rig();
    r.core.send({ type: "sustainToggled" });
    r.press(C);
    r.lift();
    r.core.send({ type: "sustainToggled" });
    expect(r.sent[1]).toEqual([{ kind: "allOff" }]);
  });
  it("switching Sustain off with a finger still down leaves the chord sounding", () => {
    const r = rig();
    r.core.send({ type: "sustainToggled" });
    r.press(C);
    r.core.send({ type: "sustainToggled" });
    expect(r.sent).toHaveLength(1);
    r.lift();
    expect(r.timers).toHaveLength(1);
  });
  it("switching Sustain on during a ring keeps the chord", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.core.send({ type: "sustainToggled" });
    r.fireTimers();
    expect(r.sent).toHaveLength(1);
  });
  it("pressing the chord already sounding strikes it again", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.press(C);
    expect(notes(r.sent[1])).toHaveLength(5);
  });
  it("going away stops the notes and forgets the finger, whose lift will never come", () => {
    const r = rig();
    r.press(C);
    r.sent.length = 0;
    r.core.silence();
    expect(r.sent).toEqual([[{ kind: "allOff" }]]);
    expect(r.core.state.get().sounding).toBeNull();
    expect(r.core.state.get().fingers).toEqual([]);
    r.fireTimers();
    r.press(G); // coming back: voices must strike, as nothing's left sounding to slide from
    expect(r.sent[1].every((c) => c.kind === "on")).toBe(true);
  });
  it("a canceled touch silences everything, so no note can stick", () => {
    const r = rig();
    r.press(C, 1);
    r.press(G, 2);
    r.cancel(1);
    expect(r.sent.at(-1)).toEqual([{ kind: "allOff" }]);
    expect(r.core.state.get().fingers).toEqual([]);
    expect(r.core.state.get().sounding).toBeNull();
  });
});

describe("settings", () => {
  it("model changes reach the sound and persist per engine", () => {
    const calls: number[] = [];
    const saved: unknown[] = [];
    const core = createCore({
      catalog: [{ id: "pad", label: "P", models: ["a", "b"] }, { id: "multi", label: "M", models: ["x"] }],
      sound: { apply: () => {}, useEngine: () => {}, useModel: (m) => calls.push(m) },
      onSettings: (s) => saved.push(s.models),
    });
    core.send({ type: "modelChanged", model: 1 });
    expect(calls).toEqual([1]);
    expect(core.views.menu.get().model).toBe(1);
    expect(saved).toEqual([{ pad: 1 }]); // the pads are the default engine
  });
  it("changing engine silences the old one and returns to that engine's last model", () => {
    const engines: [string, number][] = [];
    const sent: VoiceCommand[][] = [];
    const core = createCore({
      catalog: [{ id: "multi", label: "M", models: ["a", "b"] }, { id: "fm", label: "F", models: ["x", "y", "z"] }],
      sound: { apply: (c) => sent.push(c), useEngine: (e, m) => engines.push([e, m]), useModel: () => {} },
    });
    core.send({ type: "touch", phase: "down", pointer: 1, ref: C, r: 0, theta: 0, time: 0 });
    core.send({ type: "engineChanged", engine: "fm" });
    expect(sent.at(-1)).toEqual([{ kind: "allOff" }]);
    expect(engines).toEqual([["fm", 0]]);
    core.send({ type: "modelChanged", model: 2 });
    core.send({ type: "engineChanged", engine: "multi" });
    core.send({ type: "engineChanged", engine: "fm" });
    expect(engines.at(-1)).toEqual(["fm", 2]);
  });
  it("runs a press in well under the 2 ms budget", () => {
    const r = rig();
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      r.press({ ring: i % 2 ? "maj" : "min", col: i % 12 });
      r.lift();
    }
    expect((performance.now() - t0) / 1000).toBeLessThan(2);
  });
});

describe("a saved sound that's since been dropped", () => {
  const catalog = [{ id: "fm", label: "F", models: ["a", "b"] }];
  const sound = { apply: () => {}, useEngine: () => {}, useModel: () => {} };
  it("falls back to the first sound rather than one that isn't there", () => {
    const core = createCore({ catalog, sound, initial: { engine: "fm", models: { fm: 9 } } });
    expect(core.state.get().models.fm).toBe(0);
    expect(core.views.menu.get().models[core.views.menu.get().model]).toBe("a");
  });
  it("keeps one that's still there", () => {
    const core = createCore({ catalog, sound, initial: { engine: "fm", models: { fm: 1 } } });
    expect(core.state.get().models.fm).toBe(1);
  });
  it("copes with nothing saved", () => {
    expect(createCore({ catalog, sound }).state.get().models).toEqual({});
  });
});

describe("slide or re-strike", () => {
  it("moving voices slide by default, at the set time", () => {
    const r = rig();
    r.press(C);
    r.core.send({ type: "slideTimeChanged", ms: 300 });
    r.press(Cm);
    expect(r.sent[1]).toEqual([SLID(1, 63, 300)]);
  });
  it("the switch makes them strike", () => {
    const r = rig();
    r.core.send({ type: "slideToggled" });
    r.press(C);
    r.press(Cm);
    expect(r.sent[1]).toEqual([{ kind: "on", voice: 1, midi: 63 }]);
  });
  it("the first chord always strikes: nothing is sounding to slide from", () => {
    const r = rig();
    r.press(C);
    expect(r.sent[0].every((c) => c.kind === "on")).toBe(true);
  });
  it("a chord after the ring has ended strikes", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.fireTimers();
    r.press(G);
    expect(r.sent.at(-1)!.every((c) => c.kind === "on")).toBe(true);
    expect(r.sent.at(-1)).toHaveLength(5);
  });
  it("with sliding on, the same chord again strikes every voice", () => {
    const r = rig();
    r.press(C);
    r.press(C);
    expect(r.sent[1].every((c) => c.kind === "on")).toBe(true);
    expect(r.sent[1]).toHaveLength(5);
  });
  it("a chord in the ring time slides", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.press(Cm);
    expect(r.sent[1]).toEqual([SLID(1, 63)]);
  });
  it("a spread change slides too", () => {
    const r = rig();
    r.press(C);
    r.core.send({ type: "spreadChanged", spread: "open" });
    expect(r.sent[1].every((c) => c.kind === "slide")).toBe(true);
  });
  it("is saved", () => {
    const saved: [boolean, number][] = [];
    const core = createCore({
      catalog: [{ id: "multi", label: "M", models: ["a"] }],
      sound: { apply: () => {}, useEngine: () => {}, useModel: () => {} },
      onSettings: (s) => saved.push([s.slide, s.slideMs]),
    });
    core.send({ type: "slideToggled" });
    core.send({ type: "slideTimeChanged", ms: 40 });
    expect(saved).toEqual([[false, 80], [false, 40]]);
  });
});

describe("spread", () => {
  it("revoices a held chord at once, moving only the voices that change", () => {
    const r = rig();
    r.press(C);
    r.core.send({ type: "spreadChanged", spread: "open" });
    const moved = r.sent[1] as Extract<VoiceCommand, { kind: "slide" }>[];
    const sounding = r.core.state.get().sounding!;
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.length).toBeLessThan(5);
    for (const c of moved) expect(sounding[c.voice]).toBe(c.midi);
    expect(sounding.slice(0, 4)).toEqual(r.core.state.get().current!.voiced.upper);
  });
  it("makes no sound when nothing is playing, and the next chord uses it", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.fireTimers();
    const count = r.sent.length;
    r.core.send({ type: "spreadChanged", spread: "wide" });
    expect(r.sent).toHaveLength(count);
    expect(r.core.state.get().sounding).toBeNull();
    expect(r.core.views.ribbon.get().columns).toHaveLength(1); // no column for a chord nobody heard
    r.press(G);
    const upper = r.core.state.get().current!.voiced.upper;
    expect(upper[3] - upper[0]).toBeGreaterThanOrEqual(24);
  });
  it("is the same state whichever module asked", () => {
    const r = rig();
    r.core.send({ type: "spreadChanged", spread: "wide" });
    expect(r.core.views.controls.get().spread).toBe("wide");
  });
  it("is saved", () => {
    const saved: string[] = [];
    const core = createCore({
      catalog: [{ id: "multi", label: "M", models: ["a"] }],
      sound: { apply: () => {}, useEngine: () => {}, useModel: () => {} },
      onSettings: (s) => saved.push(s.spread),
    });
    core.send({ type: "spreadChanged", spread: "open" });
    expect(saved).toEqual(["open"]);
  });
});

describe("what the ribbon shows is what was sent", () => {
  /** Plays commands the way the voice bank does, to learn what the voices are actually sounding. */
  function voicesAfter(commands: VoiceCommand[], voices: (number | null)[]) {
    for (const c of commands) {
      if (c.kind === "allOff") voices.fill(null);
      else if (c.kind === "off") voices[c.voice] = null;
      else voices[c.voice] = c.midi;
    }
  }
  it("across a random 1,000-chord run, with every setting changing along the way", () => {
    const r = rig();
    const voices: (number | null)[] = [null, null, null, null, null];
    let seen = 0;
    let seed = 99;
    const pick = (k: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * k);
    };
    for (let i = 0; i < 1000; i++) {
      r.press({ ring: (["maj", "min"] as const)[pick(2)], col: pick(12) });
      if (pick(4) === 0) r.core.send({ type: "spreadChanged", spread: (["close", "open", "wide"] as const)[pick(3)] });
      if (pick(5) === 0) r.core.send({ type: "slideToggled" });
      if (pick(3) === 0) {
        r.lift();
        if (pick(2) === 0) r.fireTimers();
      }
      if (pick(9) === 0) r.cancel();
      for (const cmds of r.sent.splice(seen)) voicesAfter(cmds, voices);
      seen = 0;
      const view = r.core.views.ribbon.get();
      const shown = view.sounding.map((n) => n.midi);
      expect(shown).toEqual(voices.every((v) => v === null) ? [] : voices);
      const now = view.columns.at(-1)!;
      if (shown.length) expect(shown).toEqual([...now.upper, now.bass]);
      if (view.cost !== null) {
        const before = view.columns.at(-2)!;
        expect(view.cost).toBe(now.upper.reduce((sum, m, v) => sum + Math.abs(m - before.upper[v]), 0));
      }
    }
  });
  it("draws every voice inside the range it gives, over the same kind of run", () => {
    const r = rig();
    for (const spread of ["close", "open", "wide"] as const) {
      r.core.send({ type: "spreadChanged", spread });
      for (let col = 0; col < 12; col++) {
        for (const ring of ["maj", "min"] as const) {
          r.press({ ring, col });
          const { range, columns } = r.core.views.ribbon.get();
          const c = columns.at(-1)!;
          for (const m of c.upper) {
            expect(m).toBeGreaterThanOrEqual(range.upper[0]);
            expect(m).toBeLessThanOrEqual(range.upper[1]);
          }
          expect(c.bass).toBeGreaterThanOrEqual(range.bass[0]);
          expect(c.bass).toBeLessThanOrEqual(range.bass[1]);
        }
      }
    }
  });
  it("names notes for the key: V of B major reads F♯", () => {
    const r = rig();
    const core = createCore({
      catalog: [{ id: "multi", label: "M", models: ["a"] }],
      sound: { apply: () => {}, useEngine: () => {}, useModel: () => {} },
      initial: { key: { col: 5, mode: "major" } },
    });
    core.send({ type: "touch", phase: "down", pointer: 1, ref: { ring: "maj", col: 6 }, r: 0, theta: 0, time: 0 });
    const names = core.views.ribbon.get().sounding.map((n) => n.name.replace(/-?\d+$/, ""));
    expect(new Set(names)).toEqual(new Set(["F♯", "A♯", "C♯"]));
    expect(r.sent).toHaveLength(0);
  });
  it("keeps the last 8 chords as the trail, and doesn't repeat one pressed twice", () => {
    const r = rig();
    for (let col = 0; col < 10; col++) r.press({ ring: "maj", col });
    expect(r.core.views.ribbon.get().columns).toHaveLength(8);
    expect(r.core.views.ribbon.get().columns[0].name).toBe("D"); // C and G have dropped off
    expect(r.core.views.ribbon.get().columns.at(-1)!.name).toBe("E♭");
    expect(r.core.views.circle.get().trail).toHaveLength(8);
    expect(r.core.views.circle.get().trail.at(-1)).toEqual({ ring: "maj", col: 9 });
    r.press({ ring: "maj", col: 9 });
    expect(r.core.views.ribbon.get().columns).toHaveLength(8);
    expect(r.core.views.ribbon.get().columns.at(-2)!.name).toBe("A♭");
  });
  it("Clear forgets the trail, keeping only what's sounding", () => {
    const r = rig();
    r.press(C);
    r.press(G, 2);
    r.core.send({ type: "trailCleared" });
    expect(r.core.views.ribbon.get().columns.map((c) => c.name)).toEqual(["G"]);
    r.lift(1);
    r.lift(2);
    r.fireTimers();
    r.core.send({ type: "trailCleared" });
    expect(r.core.views.circle.get().trail).toEqual([]);
  });
  it("forgets the old chords when the engine changes, since the voices started over", () => {
    const r = rig();
    r.press(C);
    r.core.send({ type: "engineChanged", engine: "fm" });
    expect(r.core.views.ribbon.get().columns).toEqual([]);
    expect(r.core.views.ribbon.get().sounding).toEqual([]);
  });
  it("lists only the voices that moved, and the upper voices' cost", () => {
    const r = rig();
    r.press(C);
    expect(r.core.views.ribbon.get().cost).toBeNull();
    r.press(Cm);
    expect(r.core.views.ribbon.get().moves).toEqual([{ from: 64, to: 63, bass: false }]);
    expect(r.core.views.ribbon.get().cost).toBe(1);
    r.press(G);
    const { moves, cost, columns } = r.core.views.ribbon.get();
    const bass = moves.filter((m) => m.bass);
    expect(bass).toEqual([{ from: columns.at(-2)!.bass, to: columns.at(-1)!.bass, bass: true }]);
    // The bass isn't in the cost, since it's in its own lane and moves with the root.
    expect(cost).toBe(moves.filter((m) => !m.bass).reduce((sum, m) => sum + Math.abs(m.to - m.from), 0));
  });
});

describe("dragging the home head", () => {
  const head = (phase: "down" | "move" | "up" | "cancel", theta: number, ring: "maj" | "min" | "dim" = "maj", pointer = 7, r = 212): Intent => ({
    type: "touch", phase, pointer, ref: null, head: phase === "down", r, theta, ring, time: 0,
  });
  const key = (r: ReturnType<typeof rig>) => r.core.state.get().key;
  const grab = (r: ReturnType<typeof rig>, theta = 0) => r.core.send(head("down", theta));

  it("the hub is the dial: drag from the center onto a chord and that chord becomes the key", () => {
    const r = rig();
    r.core.send(head("down", 0, "dim", 7, 0)); // on the hub
    r.core.send(head("move", 40, "dim", 7, 30)); // still in the middle: nothing yet, however it wobbles
    expect(key(r)).toEqual({ col: 0, mode: "major" });
    r.core.send(head("move", 30, "min", 7, 120)); // onto Em
    expect(key(r)).toEqual({ col: 1, mode: "minor" });
    r.core.send(head("move", 30, "maj", 7, 180)); // out to G
    expect(key(r)).toEqual({ col: 1, mode: "major" });
    r.core.send(head("up", 30, "maj", 7, 180));
    expect(r.sent).toEqual([]);
    expect(r.core.state.get().headDrag).toBeNull();
  });
  it("touching it plays nothing, moves nothing, and lifting it does nothing", () => {
    const r = rig();
    grab(r);
    r.core.send(head("up", 0));
    expect(r.sent).toEqual([]);
    expect(key(r)).toEqual({ col: 0, mode: "major" });
    expect(r.core.state.get().headDrag).toBeNull();
  });
  it("a shaky finger isn't a drag, so a minor key survives a touch on the rim", () => {
    const r = rig();
    grab(r);
    r.core.send(head("move", 0, "min", 7, 100)); // into minor
    r.core.send(head("up", 0, "min"));
    expect(key(r).mode).toBe("minor");
    grab(r);
    r.core.send(head("move", 2, "maj")); // a wobble of about 7 units, out on the rim
    expect(key(r).mode).toBe("minor");
  });
  it("following the finger around moves the key by column", () => {
    const r = rig();
    grab(r);
    r.core.send(head("move", 30));
    expect(key(r)).toEqual({ col: 1, mode: "major" });
    r.core.send(head("move", -60));
    expect(key(r)).toEqual({ col: 10, mode: "major" });
    r.core.send(head("move", 180));
    expect(key(r)).toEqual({ col: 6, mode: "major" });
  });
  it("how far in the finger is picks the mode, and the column stays", () => {
    const r = rig();
    grab(r);
    r.core.send(head("move", 0, "min", 7, 120));
    expect(key(r)).toEqual({ col: 0, mode: "minor" });
    expect(r.core.views.circle.get().key.name).toBe("A");
    expect(r.core.views.circle.get().key.mode).toBe("minor");
    r.core.send(head("move", 0, "maj", 7, 180));
    expect(key(r)).toEqual({ col: 0, mode: "major" });
    r.core.send(head("move", 0, "dim", 7, 40)); // the hub counts as inside too
    expect(key(r).mode).toBe("minor");
  });
  it("won't flicker on the line between two columns", () => {
    const r = rig();
    grab(r);
    r.core.send(head("move", 40)); // past the line by enough: column 1
    expect(key(r).col).toBe(1);
    for (const theta of [16, 14, 17, 13, 15]) {
      r.core.send(head("move", theta));
      expect(key(r).col, `at ${theta} degrees`).toBe(1);
    }
    r.core.send(head("move", 10));
    expect(key(r).col).toBe(0);
  });
  it("what's sounding carries on with no commands, and everything naming it follows the key", () => {
    const r = rig();
    r.press(G);
    const notesBefore = r.core.views.ribbon.get().columns[0].upper;
    r.sent.length = 0;
    expect(r.core.views.readout.get().numeral).toBe("V");
    grab(r);
    r.core.send(head("move", 30)); // G major: what was V is now I
    expect(r.sent).toEqual([]);
    expect(r.core.state.get().sounding).not.toBeNull();
    expect(r.core.views.readout.get().numeral).toBe("I");
    expect(r.core.views.circle.get().chords.find((c) => c.name === "G")?.numeral).toBe("I");
    const col = r.core.views.ribbon.get().columns[0];
    expect(col.numeral).toBe("I");
    expect(col.upper).toEqual(notesBefore); // its notes don't change, only what they're called
  });
  it("lifting the head leaves a held chord alone", () => {
    const r = rig();
    r.press(C);
    grab(r);
    r.sent.length = 0;
    r.core.send(head("up", 0));
    expect(r.sent).toEqual([]);
    expect(r.timers).toEqual([]);
    expect(r.core.state.get().fingers).toEqual([1]);
  });
  it("a chord lifted while the head is held still rings out", () => {
    const r = rig();
    r.press(C);
    grab(r);
    r.lift();
    expect(r.timers).toHaveLength(1);
  });
  it("a canceled drag ends the drag, and doesn't silence a chord held by another finger", () => {
    const r = rig();
    r.press(C);
    grab(r);
    r.sent.length = 0;
    r.core.send(head("cancel", 0));
    expect(r.sent).toEqual([]);
    expect(r.core.state.get().headDrag).toBeNull();
    expect(r.core.state.get().sounding).not.toBeNull();
  });
  it("another finger's movement doesn't move the key", () => {
    const r = rig();
    grab(r);
    r.core.send(head("move", 90, "maj", 99));
    expect(key(r).col).toBe(0);
  });
  it("a second finger can't take the head away", () => {
    const r = rig();
    grab(r);
    r.core.send(head("down", 0, "maj", 8));
    expect(r.core.state.get().headDrag?.pointer).toBe(7);
  });
  it("going away ends a drag", () => {
    const r = rig();
    grab(r);
    r.core.silence();
    r.core.send(head("move", 90));
    expect(key(r).col).toBe(0);
  });
  it("a saved key comes back, and moving it saves", () => {
    const saved: unknown[] = [];
    const sound: Sound = { apply: () => {}, useEngine: () => {}, useModel: () => {} };
    const core = createCore({ catalog: [], sound, initial: { key: { col: 3, mode: "minor" } }, onSettings: (s) => saved.push(s.key) });
    expect(core.views.circle.get().key.name).toBe("F♯");
    core.send(head("down", 90));
    expect(saved).toEqual([]);
    core.send(head("move", 120));
    expect(saved).toEqual([{ col: 4, mode: "major" }]);
  });
  it("a diminished chord already played stays itself when the key moves", () => {
    const r = rig();
    r.press({ ring: "dim", col: 0 });
    expect(r.core.views.readout.get().name).toBe("B°");
    grab(r);
    r.core.send(head("move", 60)); // to D major, where B° isn't the home chord
    const v = r.core.views.readout.get();
    expect(v.name).toBe("B°");
    expect(v.relation).toBe("Outside the key");
    expect(r.core.views.ribbon.get().sounding.map((n) => n.name.replace(/\d/, ""))).toEqual(expect.arrayContaining(["B", "D", "F"]));
  });
});

describe("alteration pads", () => {
  const pad = (r: ReturnType<typeof rig>, name: Alteration, pointer = 20) => r.core.send({ type: "padDown", pad: name, pointer });
  const padUp = (r: ReturnType<typeof rig>, pointer = 20) => r.core.send({ type: "padUp", pointer });
  const readout = (r: ReturnType<typeof rig>) => r.core.views.readout.get();
  const option = (r: ReturnType<typeof rig>, id: Alteration) => r.core.views.alterations.get().options.find((o) => o.id === id)!;

  it("a tap toggles it on the chord sounding, and the sound comes at once", () => {
    const r = rig();
    r.press(G);
    r.sent.length = 0;
    pad(r, "7");
    expect(r.sent).toHaveLength(1);
    expect(readout(r).name).toBe("G7");
    expect(readout(r).numeral).toBe("V7");
    padUp(r);
    expect(readout(r).name).toBe("G7"); // lifting the pad doesn't take it off
    pad(r, "7");
    padUp(r);
    expect(readout(r).name).toBe("G");
  });
  it("common tones get no command when a chord's altered", () => {
    const r = rig();
    r.press(G);
    const before = r.core.state.get().sounding!;
    r.sent.length = 0;
    pad(r, "7");
    const after = r.core.state.get().sounding!;
    const moved = before.flatMap((m, v) => (m === after[v] ? [] : [v]));
    expect(moved.length).toBeGreaterThan(0);
    expect(r.sent[0].map((c) => (c as { voice: number }).voice).sort()).toEqual(moved);
  });
  it("a tapped alteration latches, and every chord takes it until it's tapped off", () => {
    const F: ChordRef = { ring: "maj", col: 11 };
    const r = rig();
    r.press(G);
    pad(r, "7");
    padUp(r);
    r.lift();
    r.press(C);
    expect(readout(r).name).toBe("C7");
    r.lift();
    r.press(F);
    expect(readout(r).name).toBe("F7");
    pad(r, "7"); // tapped off: the sounding chord loses it, and so does the next
    padUp(r);
    expect(readout(r).name).toBe("F");
    r.lift();
    r.press(G);
    expect(readout(r).name).toBe("G");
  });
  it("a latch follows its group: tapping maj7 replaces a latched 7", () => {
    const r = rig();
    pad(r, "7");
    padUp(r);
    pad(r, "maj7");
    padUp(r);
    r.press(C);
    expect(readout(r).name).toBe("Cmaj7");
  });
  it("Major and Minor latch too, and apply only where they change something", () => {
    const r = rig();
    r.press(C);
    pad(r, "minor");
    padUp(r);
    expect(readout(r).name).toBe("Cm");
    r.lift();
    r.press(G);
    expect(readout(r).name).toBe("Gm"); // latched
    r.lift();
    r.press({ ring: "min", col: 0 });
    expect(readout(r).name).toBe("Am"); // already minor: nothing to change
    pad(r, "major"); // replaces Minor in the latch, and makes Am major
    padUp(r);
    expect(readout(r).name).toBe("A");
    pad(r, "major"); // tapped off
    padUp(r);
    r.lift();
    r.press(G);
    expect(readout(r).name).toBe("G");
  });
  it("while a pad is held the circle names every chord as a press would give it, and goes back on lift", () => {
    const r = rig();
    const cell = (ring: "maj" | "min", col: number) => r.core.views.circle.get().chords.find((c) => c.ref.ring === ring && c.ref.col === col)!;
    pad(r, "7", 40);
    expect(r.core.views.circle.get().relabeled).toBe(true);
    expect([cell("maj", 0).name, cell("maj", 1).numeral, cell("min", 11).name]).toEqual(["C7", "V7", "Dm7"]);
    r.press(G); // the hold is used, so lifting takes the 7 back off
    padUp(r, 40);
    expect(r.core.views.circle.get().relabeled).toBe(false);
    expect(cell("maj", 0).name).toBe("C");
  });
  it("the pads show latched and held apart", () => {
    const r = rig();
    pad(r, "7");
    expect(option(r, "7")).toMatchObject({ latched: true, held: true });
    padUp(r);
    expect(option(r, "7")).toMatchObject({ latched: true, held: false, on: true });
    pad(r, "minor", 30);
    expect(option(r, "minor")).toMatchObject({ latched: true, held: true });
  });
  it("hold a pad, press chords: each chord takes it", () => {
    const r = rig();
    pad(r, "7");
    expect(r.sent).toEqual([]); // in silence a pad just waits
    r.press(G);
    expect(readout(r).name).toBe("G7");
    r.lift();
    r.press(C);
    expect(readout(r).name).toBe("C7");
    r.lift();
    padUp(r);
    r.press(G);
    expect(readout(r).name).toBe("G");
  });
  it("two pads held stack", () => {
    const r = rig();
    pad(r, "7", 20);
    pad(r, "sus4", 21);
    r.press(G);
    expect(readout(r).name).toBe("G7sus4");
  });
  it("a touch that takes a pad off doesn't also hold it for the next chord", () => {
    const r = rig();
    r.press(G);
    pad(r, "7", 20);
    padUp(r, 20);
    pad(r, "7", 21); // takes it off, and stays down
    expect(readout(r).name).toBe("G");
    r.lift();
    r.press(C);
    expect(readout(r).name).toBe("C");
  });
  it("a touch that puts a pad on holds it for the next chord", () => {
    const r = rig();
    r.press(G);
    pad(r, "7");
    r.lift();
    r.press(C);
    expect(readout(r).name).toBe("C7");
  });
  it("a pad doesn't stop or restart the finger's chord, and a lift still rings", () => {
    const r = rig();
    r.press(G);
    pad(r, "9");
    padUp(r);
    expect(r.timers).toEqual([]);
    r.lift();
    expect(r.timers).toHaveLength(1);
  });
  it("a change while it's ringing gets a full ring, and the old ring can't cut it off", () => {
    const r = rig();
    r.press(G);
    r.lift();
    const oldRing = r.timers.splice(0);
    pad(r, "7");
    expect(r.timers).toHaveLength(1);
    oldRing[0].fn();
    expect(r.core.state.get().sounding).not.toBeNull();
    r.fireTimers();
    expect(r.core.state.get().sounding).toBeNull();
  });
  it("in silence, a pad changes nothing that's been played", () => {
    const r = rig();
    r.press(G);
    r.lift();
    r.fireTimers();
    r.sent.length = 0;
    const columns = r.core.views.ribbon.get().columns.length;
    pad(r, "7");
    expect(r.sent).toEqual([]);
    expect(readout(r).name).toBe("G");
    expect(r.core.views.ribbon.get().columns).toHaveLength(columns);
    expect(option(r, "7").on).toBe(true); // it shows as held
    padUp(r);
    expect(option(r, "7")).toMatchObject({ on: true, latched: true }); // and, tapped, it stays on for the next chord
  });
  it("a canceled pad touch lets go of the pad and leaves the chord alone", () => {
    const r = rig();
    r.press(G);
    pad(r, "7");
    r.sent.length = 0;
    r.core.send({ type: "touch", phase: "cancel", pointer: 20, ref: null, r: 0, theta: 0, time: 0 });
    expect(r.sent).toEqual([]);
    expect(r.core.state.get().sounding).not.toBeNull();
  });
  it("going away lets go of every pad held for chords, and keeps the latch", () => {
    const r = rig();
    pad(r, "sus4", 21);
    r.press(G); // sus4 was held for this chord, so it's momentary
    r.core.silence();
    r.press(C);
    expect(readout(r).name).toBe("C");
    expect(r.core.state.get().pads).toEqual([]);
    pad(r, "7", 22);
    padUp(r, 22);
    r.core.silence();
    r.press(G);
    expect(readout(r).name).toBe("G7");
  });
  it("what the ribbon shows is what was sent, with alterations too", () => {
    const r = rig();
    const voices: (number | null)[] = Array(5).fill(null);
    const follow = () => {
      for (const c of r.sent.flat()) {
        if (c.kind === "on" || c.kind === "slide") voices[c.voice] = c.midi;
      }
      r.sent.length = 0;
    };
    const steps: [ChordRef, Alteration | null][] = [[C, null], [G, "7"], [Cm, "9"], [C, "sus4"], [G, "add9"], [Cm, "maj7"]];
    for (const [ref, name] of steps) {
      r.press(ref);
      if (name) pad(r, name);
      follow();
      const col = r.core.views.ribbon.get().columns.at(-1)!;
      expect(voices).toEqual([...col.upper, col.bass]);
      if (name) padUp(r);
      r.lift();
    }
  });
  it("the ribbon gets a column for a change, named for what it became", () => {
    const r = rig();
    r.press(G);
    pad(r, "7");
    const columns = r.core.views.ribbon.get().columns;
    expect(columns.map((c) => c.numeral)).toEqual(["V", "V7"]);
  });
  it("spread change keeps the alteration", () => {
    const r = rig();
    r.press(G);
    pad(r, "7");
    r.core.send({ type: "spreadChanged", spread: "open" });
    expect(readout(r).name).toBe("G7");
    expect(new Set(r.core.state.get().sounding!.map((m) => m % 12))).toEqual(new Set([7, 11, 2, 5]));
  });
  it("what a pad offers is named for the chord sounding and judged against the key", () => {
    const r = rig();
    expect(option(r, "7")).toMatchObject({ chord: "", on: false, inKey: null });
    r.press(G);
    expect(option(r, "7")).toMatchObject({ chord: "G7", on: false, inKey: true });
    expect(option(r, "maj7")).toMatchObject({ chord: "Gmaj7", inKey: false });
    pad(r, "7");
    expect(option(r, "7")).toMatchObject({ chord: "G7", on: true });
    expect(option(r, "sus4")).toMatchObject({ chord: "G7sus4", inKey: true }); // shows what it would stack to
  });
  it("a diminished chord offers no sus", () => {
    const r = rig();
    r.press({ ring: "dim", col: 0 });
    expect(option(r, "sus4").available).toBe(false);
    pad(r, "sus4");
    expect(readout(r).name).toBe("B°");
    expect(option(r, "7")).toMatchObject({ chord: "Bø7", inKey: true });
  });

  describe("Major and Minor", () => {
    function keyed(key: { col: number; mode: "major" | "minor" }) {
      const sent: VoiceCommand[][] = [];
      const sound: Sound = { apply: (c) => void (c.length && sent.push(c)), useEngine: () => {}, useModel: () => {} };
      const timers: (() => void)[] = [];
      const core = createCore({ catalog: [], sound, setTimer: (fn) => void timers.push(fn), initial: { key } });
      const fire = () => timers.splice(0).forEach((t) => t());
      let pointer = 100;
      const down = (ref: ChordRef) => core.send({ type: "touch", phase: "down", pointer: 1, ref, r: 0, theta: 0, time: 0 });
      const tap = (pad: Alteration) => {
        const p = pointer++;
        core.send({ type: "padDown", pad, pointer: p });
        core.send({ type: "padUp", pointer: p });
      };
      const name = () => core.views.readout.get().name;
      const numeral = () => core.views.readout.get().numeral;
      return { core, sent, down, tap, name, numeral, fire };
    }
    const AMINOR = { col: 0, mode: "minor" as const };
    const Em: ChordRef = { ring: "min", col: 1 };

    it("Creep in G: G, Bm made Major, C, C made Minor, and every one is inside the wedge", () => {
      const g = keyed({ col: 1, mode: "major" });
      const played: string[] = [];
      g.down({ ring: "maj", col: 1 });
      played.push(`${g.name()} ${g.numeral()}`);
      g.down({ ring: "min", col: 2 }); // Bm, iii
      g.tap("major");
      played.push(`${g.name()} ${g.numeral()}`);
      g.down({ ring: "maj", col: 0 });
      played.push(`${g.name()} ${g.numeral()}`);
      g.tap("minor");
      played.push(`${g.name()} ${g.numeral()}`);
      expect(played).toEqual(["G I", "B III", "C IV", "Cm iv"]);
      expect(g.core.views.readout.get().relation).toBe("Outside the key");
    });
    it("only the third moves: C to Cm is one voice, down a semitone", () => {
      const r = rig();
      r.press(C);
      const before = r.core.state.get().sounding!;
      r.sent.length = 0;
      r.core.send({ type: "padDown", pad: "minor", pointer: 9 });
      const after = r.core.state.get().sounding!;
      const changed = before.flatMap((n, v) => (n === after[v] ? [] : [[n, after[v]]]));
      expect(changed).toEqual([[64, 63]]);
    });
    it("each is offered only where it changes something", () => {
      const r = rig();
      r.press(C);
      const opt = (id: Alteration) => r.core.views.alterations.get().options.find((o) => o.id === id)!;
      expect(opt("major").available).toBe(false);
      expect(opt("minor")).toMatchObject({ available: true, chord: "Cm", inKey: false });
      r.press({ ring: "min", col: 0 }, 2);
      expect(opt("minor").available).toBe(false);
      expect(opt("major")).toMatchObject({ available: true, chord: "A" });
      r.press({ ring: "dim", col: 0 }, 3);
      expect(opt("major").chord).toBe("B");
      expect(opt("minor").chord).toBe("Bm");
    });
    it("held, each chord pressed takes it: a run of minor chords", () => {
      const r = rig();
      r.core.send({ type: "padDown", pad: "minor", pointer: 9 });
      for (const [ref, want] of [[C, "Cm"], [G, "Gm"], [{ ring: "maj", col: 11 } as ChordRef, "Fm"]] as const) {
        r.press(ref);
        expect(r.core.views.readout.get().name).toBe(want);
        r.lift();
      }
    });
    it("stacks with a 7: C made minor with a 7 is Cm7, iv7", () => {
      const g = keyed({ col: 1, mode: "major" });
      g.down({ ring: "maj", col: 0 });
      g.tap("minor");
      g.tap("7");
      expect(`${g.name()} ${g.numeral()}`).toBe("Cm7 iv7");
    });
    it("a chord made the other quality heads where that chord would", () => {
      const g = keyed({ col: 1, mode: "major" });
      g.down({ ring: "min", col: 2 });
      g.tap("major"); // B major in G leads to Em, as V of vi
      expect(g.core.state.get().current?.alts.quality).toBe("major");
      g.fire(); // the hold, since the finger's still down
      const next = g.core.views.circle.get().next;
      expect(next[0].ref).toEqual({ ring: "min", col: 1 }); // III goes to vi first in the counts, too
    });

    describe("on v in a minor key, Major is the raised V", () => {
      it("moves only the third, so the leading tone is what you hear", () => {
        const m = keyed(AMINOR);
        m.down(Em);
        const before = m.core.state.get().sounding!;
        m.sent.length = 0;
        m.tap("major");
        const after = m.core.state.get().sounding!;
        expect(m.sent).toHaveLength(1);
        const changed = before.flatMap((n, v) => (n === after[v] ? [] : [[n, after[v]]]));
        expect(changed).toEqual([[67, 68]]); // G to G♯
        expect(m.core.views.readout.get()).toMatchObject({ name: "E", numeral: "V", relation: "Dominant, raised" });
        expect(m.core.views.ribbon.get().leadingTone?.name).toBe("G♯4");
      });
      it("takes a 7, and marks the leading tone through it", () => {
        const m = keyed(AMINOR);
        m.down(Em);
        m.tap("major");
        m.tap("7");
        expect(m.core.views.readout.get()).toMatchObject({ name: "E7", numeral: "V7" });
        expect(m.core.views.ribbon.get().leadingTone).not.toBeNull();
      });
      it("a second tap takes it off, latch and all, so the next chord is itself", () => {
        const m = keyed(AMINOR);
        m.down(Em);
        m.tap("major");
        m.tap("major");
        expect(m.name()).toBe("Em");
        m.down({ ring: "min", col: 0 });
        expect(m.name()).toBe("Am");
        expect(m.core.views.ribbon.get().leadingTone).toBeNull();
      });
      it("anywhere else, a chord made major has no leading tone marked", () => {
        const m = keyed(AMINOR);
        m.down({ ring: "min", col: 0 });
        m.tap("major");
        expect(m.name()).toBe("A");
        expect(m.core.views.ribbon.get().leadingTone).toBeNull();
      });
    });
  });
});

describe("next chords (shown from the press until the sound ends)", () => {
  const next = (r: ReturnType<typeof rig>) => r.core.views.circle.get().next;
  const names = (r: ReturnType<typeof rig>) =>
    next(r).map((a) => r.core.views.circle.get().chords.find((c) => c.ref.ring === a.ref.ring && c.ref.col === a.ref.col)?.numeral);

  it("a press sounds at once, and its next chords come with it, with no sound of their own", () => {
    const r = rig();
    r.press(G);
    expect(r.sent).toHaveLength(1);
    expect(names(r).slice(0, 3)).toEqual(["I", "vi", "IV"]); // modern pop
  });
  it("the circle gets every one the counts give, likeliest first; the table, the top three", () => {
    const r = rig();
    r.press(G);
    const ps = next(r).map((a) => a.p);
    expect(ps.length).toBeGreaterThan(3);
    expect(ps).toEqual([...ps].sort((a, b) => b - a));
    expect(r.core.views.ribbon.get().next).toHaveLength(3);
  });
  it("a latch that makes two cells the same chord lists it once, odds together", () => {
    const r = rig();
    r.core.send({ type: "padDown", pad: "major", pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
    r.press({ ring: "min", col: 2 }); // Bm made B
    const names = r.core.views.ribbon.get().next.map((n) => n.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it("they stay while the chord rings on after a lift, and go when the sound ends", () => {
    const r = rig();
    r.press(G);
    r.lift();
    expect(next(r).length).toBeGreaterThan(0);
    r.fireTimers();
    expect(next(r)).toEqual([]);
  });
  it("a new chord replaces them with its own", () => {
    const r = rig();
    r.press(G);
    r.press(C, 2);
    expect(names(r)[0]).toBe("IV");
  });
  it("a canceled touch clears them with the sound", () => {
    const r = rig();
    r.press(G);
    r.cancel();
    expect(next(r)).toEqual([]);
  });
  it("from G in C major, C is the likeliest", () => {
    const r = rig();
    r.press(G);
    expect(next(r)[0].ref).toEqual({ ring: "maj", col: 0 });
  });
  it("each one's cost is what the move would really cost, as the ribbon would then report it, at every spread", () => {
    for (const spread of ["close", "open", "wide"] as const) {
      const r = rig();
      r.core.send({ type: "spreadChanged", spread });
      r.press(C);
      expect(next(r).length).toBeGreaterThan(0);
      for (const arrow of next(r)) {
        const q = rig();
        q.core.send({ type: "spreadChanged", spread });
        q.press(C);
        q.lift();
        q.press(arrow.ref);
        expect(q.core.views.ribbon.get().cost, `${spread} ${JSON.stringify(arrow.ref)}`).toBe(arrow.cost);
      }
    }
  });
  it("the sounding notes say which one a pad added, the 7th or the 9th", () => {
    const r = rig();
    r.press(C);
    expect(r.core.views.ribbon.get().sounding.every((n) => n.role === null)).toBe(true);
    r.lift();
    r.core.send({ type: "padDown", pad: "7", pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
    r.press(G);
    const roles = (r: ReturnType<typeof rig>) =>
      Object.fromEntries(r.core.views.ribbon.get().sounding.filter((n) => n.role).map((n) => [n.name.replace(/\d/g, ""), n.role]));
    expect(roles(r)).toEqual({ F: "7" });
    r.lift();
    r.core.send({ type: "padDown", pad: "9", pointer: 21 });
    r.core.send({ type: "padUp", pointer: 21 });
    r.press(C); // C9: B♭ is the 7th, D the 9th
    expect(roles(r)["B♭"]).toBe("7");
    const sounding = r.core.views.ribbon.get().sounding;
    expect(sounding.some((n) => n.name.startsWith("D"))).toBe(true);
    for (const n of sounding) expect(n.role).toBe(n.name.startsWith("D") ? "9" : n.name.startsWith("B♭") ? "7" : null);
  });

  it("with a latch on, each is named and costed as the chord a press would give", () => {
    const r = rig();
    r.core.send({ type: "padDown", pad: "7", pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
    r.press(G);
    expect(r.core.views.ribbon.get().next[0].name).toBe("C7");
    // From C7, Am7 must be a target to tell plain and latched costs apart.
    // From C7, Am7 is 1 semitone away and plain Am would be 4, so this tells the two apart.
    r.lift();
    r.press(C);
    const target = next(r).find((a) => a.ref.ring === "min" && a.ref.col === 0)!;
    expect(target).toBeTruthy();
    const q = rig();
    q.core.send({ type: "padDown", pad: "7", pointer: 20 });
    q.core.send({ type: "padUp", pointer: 20 });
    q.press(C);
    q.lift();
    q.press(target.ref);
    expect(q.core.views.readout.get().name).toBe("Am7");
    expect(q.core.views.ribbon.get().cost).toBe(target.cost);
  });
  it("Off shows none", () => {
    const r = rig();
    r.core.send({ type: "presetChanged", preset: null });
    r.press(G);
    expect(next(r)).toEqual([]);
  });
  it("switching to Off clears them, and back again shows them for the chord sounding", () => {
    const r = rig();
    r.press(G);
    r.core.send({ type: "presetChanged", preset: null });
    expect(next(r)).toEqual([]);
    r.core.send({ type: "presetChanged", preset: "jazz" });
    expect(next(r).length).toBeGreaterThan(0);
  });
  it("switching preset changes them", () => {
    const r = rig();
    r.press(C);
    const pop = next(r)[0];
    r.core.send({ type: "presetChanged", preset: "jazz" });
    expect(next(r)[0]).not.toEqual(pop);
  });
  it("the choice is saved", () => {
    const saved: unknown[] = [];
    const sound: Sound = { apply: () => {}, useEngine: () => {}, useModel: () => {} };
    const core = createCore({ catalog: [], sound, onSettings: (s) => saved.push(s.preset) });
    core.send({ type: "presetChanged", preset: "jazz" });
    expect(saved).toEqual(["jazz"]);
  });
  it("altering the chord sounding keeps them, for what it became", () => {
    const r = rig();
    r.press(G);
    r.core.send({ type: "padDown", pad: "7", pointer: 20 });
    expect(next(r).length).toBeGreaterThan(0);
  });
});

describe("sliding from a held chord onto a star (docs/GESTURES.md)", () => {
  const F: ChordRef = { ring: "maj", col: 11 };
  const Am: ChordRef = { ring: "min", col: 0 };
  const Db: ChordRef = { ring: "maj", col: 7 };
  const slideTo = (r: ReturnType<typeof rig>, ref: ChordRef | null, pointer = 1, at = { r: 0, theta: 0 }) =>
    r.core.send({ type: "touch", phase: "move", pointer, ref, ...at, time: 0 });
  const held = (ref = C) => {
    const r = rig();
    r.press(ref);
    r.fireHolds();
    return r;
  };
  const stars = (r: ReturnType<typeof rig>) => r.core.views.circle.get().next.map((n) => `${n.ref.ring}-${n.ref.col}`);
  const trail = (r: ReturnType<typeof rig>) => r.core.views.circle.get().trail;

  it("the chords used here are what the test thinks: G, F and Am are stars of C, D♭ isn't", () => {
    const s = stars(held());
    expect(s).toEqual(expect.arrayContaining(["maj-1", "maj-11", "min-0"]));
    expect(s).not.toContain("maj-7");
  });
  it("once the stars show, sliding onto one plays it, moving only the voices that change", () => {
    const r = held();
    slideTo(r, G);
    expect(r.core.state.get().current?.ref).toEqual(G);
    expect(r.core.views.readout.get().name).toBe("G");
    // From C4 E4 G4 C5 over C3: G keeps its G, so that voice gets no command.
    const cmds = r.sent[1];
    expect(cmds.every((c) => c.kind === "slide")).toBe(true);
    const sounding = r.core.state.get().sounding!;
    expect(cmds).toHaveLength([60, 64, 67, 72, 48].filter((m, v) => sounding[v] !== m).length);
    expect(sounding).toContain(67);
  });
  it("the stars stay the pressed chord's while the finger is down, and become the kept chord's on lifting", () => {
    const r = held();
    const fromC = stars(r);
    slideTo(r, G);
    expect(stars(r)).toEqual(fromC);
    r.lift();
    expect(stars(r)).not.toEqual(fromC);
    expect(r.core.state.get().reach).toBeNull();
  });
  it("lifting on a star keeps it: it rings on, and the trail reads C then G", () => {
    const r = held();
    slideTo(r, G);
    r.lift();
    expect(r.timers.map((t) => t.ms)).toEqual([1000]);
    expect(trail(r)).toEqual([C, G]);
    expect(r.core.views.ribbon.get().columns.map((c) => c.name)).toEqual(["C", "G"]);
  });
  it("sliding back onto the chord pressed returns to it, voices and trail as they were", () => {
    const r = held();
    const before = r.core.state.get();
    slideTo(r, G);
    slideTo(r, C);
    const after = r.core.state.get();
    expect(after.current).toBe(before.current);
    expect(after.sounding).toEqual(before.sounding);
    expect(after.history).toBe(before.history);
  });
  it("from one star to another, only the last one previewed joins the trail", () => {
    const r = held();
    slideTo(r, G);
    slideTo(r, F);
    expect(r.core.state.get().current?.ref).toEqual(F);
    expect(trail(r)).toEqual([C, F]);
  });
  it("a star sounds the same however the finger got there", () => {
    const direct = held();
    slideTo(direct, Am);
    const roundabout = held();
    slideTo(roundabout, G);
    slideTo(roundabout, F);
    slideTo(roundabout, Am);
    expect(roundabout.core.state.get().sounding).toEqual(direct.core.state.get().sounding);
  });
  it("wandering over a chord that isn't a star, or off the circle, plays nothing", () => {
    const r = held();
    slideTo(r, Db);
    slideTo(r, null);
    expect(r.sent).toHaveLength(1);
    expect(r.core.state.get().current?.ref).toEqual(C);
    slideTo(r, G);
    slideTo(r, Db);
    expect(r.core.state.get().current?.ref).toEqual(G);
    expect(r.sent).toHaveLength(2);
  });
  it("before the hold time, nothing slides, so a quick move never plays a chord by accident", () => {
    const r = rig();
    r.press(C);
    slideTo(r, G);
    expect(r.core.state.get().current?.ref).toEqual(C);
    expect(r.sent).toHaveLength(1);
  });
  it("a shaky finger before the hold can still slide after it", () => {
    const r = rig();
    r.core.send({ type: "touch", phase: "down", pointer: 1, ref: C, r: 176, theta: 0, time: 0 });
    slideTo(r, C, 1, { r: 180, theta: 1 });
    r.fireHolds();
    slideTo(r, G, 1, { r: 176, theta: 30 });
    expect(r.core.state.get().current?.ref).toEqual(G);
  });
  it("moving past the threshold before the hold is a swipe, and that touch never slides", () => {
    const r = rig();
    r.core.send({ type: "touch", phase: "down", pointer: 1, ref: C, r: 176, theta: 0, time: 0 });
    slideTo(r, C, 1, { r: 176, theta: 9 }); // 28 units sideways: a swipe, but too sideways to go anywhere
    r.fireHolds();
    slideTo(r, G, 1, { r: 176, theta: 30 });
    expect(r.core.state.get().current?.ref).toEqual(C);
    expect(r.sent).toHaveLength(1);
  });
  it("another finger's movement doesn't slide the chord", () => {
    const r = held();
    slideTo(r, G, 2);
    expect(r.core.state.get().current?.ref).toEqual(C);
  });
  it("with two fingers down, the newest press is the one that slides", () => {
    const r = rig();
    r.press(C, 1);
    r.press(Am, 2);
    r.fireHolds();
    slideTo(r, G, 1);
    expect(r.core.state.get().current?.ref).toEqual(Am);
    slideTo(r, F, 2);
    expect(r.core.state.get().current?.ref).toEqual(F);
  });
  it("with next chords off there are no stars, so nothing slides", () => {
    const r = rig();
    r.core.send({ type: "presetChanged", preset: null });
    r.press(C);
    r.fireHolds();
    slideTo(r, G);
    expect(r.core.state.get().current?.ref).toEqual(C);
  });
  it("a touch canceled mid-slide silences everything and forgets the slide", () => {
    const r = held();
    slideTo(r, G);
    r.cancel();
    expect(r.sent[r.sent.length - 1]).toEqual([{ kind: "allOff" }]);
    expect(r.core.state.get().reach).toBeNull();
    slideTo(r, F);
    expect(r.core.state.get().sounding).toBeNull();
  });
  it("with slides off, the voices that change strike instead", () => {
    const r = rig();
    r.core.send({ type: "slideToggled" });
    r.press(C);
    r.fireHolds();
    slideTo(r, G);
    expect(r.sent[1].every((c) => c.kind === "on")).toBe(true);
  });
  it("a latch applies to the star slid onto, as it would to a press", () => {
    const r = rig();
    r.core.send({ type: "padDown", pad: "7", pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
    r.press(C);
    r.fireHolds();
    slideTo(r, G);
    expect(r.core.views.readout.get().name).toBe("G7");
  });
  it("a pad tapped before sliding changes what sliding back returns to", () => {
    const r = held();
    r.core.send({ type: "padDown", pad: "maj7", pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
    slideTo(r, G);
    slideTo(r, C);
    expect(r.core.views.readout.get().name).toBe("Cmaj7");
  });
});

describe("long press lights the chord that leads here (docs/GESTURES.md)", () => {
  const Am: ChordRef = { ring: "min", col: 0 };
  const Dm: ChordRef = { ring: "min", col: 11 };
  const E: ChordRef = { ring: "maj", col: 4 };
  const A: ChordRef = { ring: "maj", col: 3 };
  const slideTo = (r: ReturnType<typeof rig>, ref: ChordRef | null, pointer = 1) =>
    r.core.send({ type: "touch", phase: "move", pointer, ref, r: 100, theta: 90, time: 0 });
  const longPress = (ref: ChordRef) => {
    const r = rig();
    r.press(ref);
    r.fireHolds();
    r.fireLongs();
    return r;
  };
  const leads = (r: ReturnType<typeof rig>) => r.core.views.circle.get().leads;

  it("holding C long enough lights G7", () => {
    expect(leads(longPress(C))).toEqual({ ref: G, name: "G7" });
  });
  it("on Am it's E7, on Dm A7: a fifth above, not one step round the circle", () => {
    expect(leads(longPress(Am))).toEqual({ ref: E, name: "E7" });
    expect(leads(longPress(Dm))).toEqual({ ref: A, name: "A7" });
  });
  it("not before the long press: the ordinary hold lights nothing", () => {
    const r = rig();
    r.press(C);
    r.fireHolds();
    expect(leads(r)).toBeNull();
  });
  it("a quick tap never gets there", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.fireLongs();
    expect(leads(r)).toBeNull();
  });
  it("sliding onto it plays it as a 7th, though G is also a star", () => {
    const r = longPress(C);
    slideTo(r, G);
    expect(r.core.views.readout.get().name).toBe("G7");
  });
  it("before the long press, the same slide plays plain G", () => {
    const r = rig();
    r.press(C);
    r.fireHolds();
    slideTo(r, G);
    expect(r.core.views.readout.get().name).toBe("G");
  });
  it("from Am, sliding onto E plays E7, and lifting keeps it, ringing on", () => {
    const r = longPress(Am);
    slideTo(r, E);
    expect(r.core.views.readout.get().name).toBe("E7");
    r.lift();
    expect(r.core.views.readout.get().name).toBe("E7");
    expect(r.timers.map((t) => t.ms)).toEqual([1000]);
    expect(leads(r)).toBeNull();
  });
  it("it stays lit while sliding, and sliding back still returns to the chord pressed", () => {
    const r = longPress(C);
    slideTo(r, G);
    expect(leads(r)).toEqual({ ref: G, name: "G7" });
    slideTo(r, C);
    expect(r.core.views.readout.get().name).toBe("C");
  });
  it("a latch doesn't change it: it's always a plain dominant 7th", () => {
    const r = rig();
    r.core.send({ type: "padDown", pad: "maj7", pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
    r.press(C);
    r.fireHolds();
    r.fireLongs();
    expect(r.core.views.readout.get().name).toBe("Cmaj7");
    slideTo(r, G);
    expect(r.core.views.readout.get().name).toBe("G7");
  });
  it("works with next chords off: no stars, but the long press still lights it and slides to it", () => {
    const r = rig();
    r.core.send({ type: "presetChanged", preset: null });
    r.press(C);
    r.fireHolds();
    r.fireLongs();
    expect(leads(r)?.name).toBe("G7");
    slideTo(r, G);
    expect(r.core.views.readout.get().name).toBe("G7");
  });
  it("a swipe spends the touch: no long press after it", () => {
    const r = rig();
    r.core.send({ type: "touch", phase: "down", pointer: 1, ref: C, r: 176, theta: 0, time: 0 });
    r.core.send({ type: "touch", phase: "move", pointer: 1, ref: null, r: 150, theta: 0, time: 0 });
    r.fireHolds();
    r.fireLongs();
    expect(leads(r)).toBeNull();
  });
  it("the diminished chord lights nothing", () => {
    expect(leads(longPress({ ring: "dim", col: 0 }))).toBeNull();
  });
  it("a new press starts over: the old long press can't light the new chord early", () => {
    const r = rig();
    r.press(C);
    r.fireHolds();
    r.lift();
    r.press(Am);
    const [stale, fresh] = r.longs.splice(0);
    stale.fn(); // C's timer, from the earlier press
    expect(leads(r)).toBeNull();
    fresh.fn();
    expect(leads(r)).toEqual({ ref: E, name: "E7" });
  });
});

describe("swipes (docs/GESTURES.md)", () => {
  const Am: ChordRef = { ring: "min", col: 0 };
  const Em: ChordRef = { ring: "min", col: 1 };
  const F: ChordRef = { ring: "maj", col: 11 };
  const Bdim: ChordRef = { ring: "dim", col: 0 };
  const CENTER = { maj: 176, min: 118, dim: 71 };
  /** Lands on a chord at its cell's middle, as a thumb would. */
  const land = (r: ReturnType<typeof rig>, ref: ChordRef, pointer = 1) =>
    r.core.send({ type: "touch", phase: "down", pointer, ref, r: CENTER[ref.ring], theta: ref.col * 30, time: 0 });
  const to = (r: ReturnType<typeof rig>, at: { r: number; theta: number }, pointer = 1, ref: ChordRef | null = null) =>
    r.core.send({ type: "touch", phase: "move", pointer, ref, ...at, time: 0 });
  const now = (r: ReturnType<typeof rig>) => r.core.state.get().current?.ref;

  it("in on C plays A minor, moving only the voices that change (G up to A, the bass C down to A)", () => {
    const r = rig();
    land(r, C);
    to(r, { r: 150, theta: 0 }); // 26 units in
    expect(now(r)).toEqual(Am);
    expect(r.core.views.readout.get().name).toBe("Am");
    expect(r.sent[1]).toEqual([SLID(2, 69), SLID(4, 45)]);
  });
  it("out on Am plays C", () => {
    const r = rig();
    land(r, Am);
    to(r, { r: 145, theta: 0 });
    expect(now(r)).toEqual(C);
  });
  it("works on any major and minor: in on G is E minor, out on Dm is F", () => {
    const r = rig();
    land(r, G);
    to(r, { r: 150, theta: 30 });
    expect(now(r)).toEqual(Em);
    r.lift();
    land(r, { ring: "min", col: 11 });
    to(r, { r: 145, theta: -30 });
    expect(now(r)).toEqual(F);
  });
  it("nothing happens before the finger has gone 24 units", () => {
    const r = rig();
    land(r, C);
    to(r, { r: 160, theta: 0 }); // 16 units: a swipe under way, not yet judged
    expect(now(r)).toEqual(C);
    to(r, { r: 152, theta: 0 });
    expect(now(r)).toEqual(Am);
  });
  it("out on a major and in on a minor are kept free: nothing plays", () => {
    const r = rig();
    land(r, C);
    to(r, { r: 202, theta: 0 });
    expect(now(r)).toEqual(C);
    r.lift();
    land(r, Am);
    to(r, { r: 92, theta: 0 });
    expect(now(r)).toEqual(Am);
    expect(r.sent).toHaveLength(2); // the two presses, nothing else
  });
  it("the diminished chord doesn't swipe either way", () => {
    const r = rig();
    land(r, Bdim);
    to(r, { r: 45, theta: 0 });
    expect(now(r)).toEqual(Bdim);
  });
  it("within 35 degrees of straight in it swipes; more sideways than that, it doesn't", () => {
    // From (176, 0°), a 30-unit move at an angle a off straight down the line to the center.
    const off = (a: number) => {
      const x = 30 * Math.sin((a * Math.PI) / 180), y = -176 + 30 * Math.cos((a * Math.PI) / 180);
      return { r: Math.hypot(x, y), theta: (Math.atan2(x, -y) * 180) / Math.PI };
    };
    const at = (a: number) => {
      const r = rig();
      land(r, C);
      to(r, off(a));
      return now(r);
    };
    expect(at(30)).toEqual(Am);
    expect(at(-30)).toEqual(Am);
    expect(at(40)).toEqual(C);
    expect(at(-40)).toEqual(C);
  });
  it("judged once: a sideways start that then turns inward doesn't swipe", () => {
    const r = rig();
    land(r, C);
    to(r, { r: 176, theta: 9 }); // 28 units sideways
    to(r, { r: 130, theta: 9 });
    expect(now(r)).toEqual(C);
  });
  it("after the hold, the same inward move is a slide, and plays only on reaching a star's cell", () => {
    const r = rig();
    land(r, C);
    r.fireHolds();
    to(r, { r: 150, theta: 0 }, 1, C);
    expect(now(r)).toEqual(C);
    to(r, { r: 130, theta: 0 }, 1, Am);
    expect(now(r)).toEqual(Am);
  });
  it("after a swipe, the touch is spent: no slide later, and lifting keeps the chord, ringing on", () => {
    const r = rig();
    land(r, C);
    to(r, { r: 150, theta: 0 });
    r.fireHolds();
    to(r, { r: 176, theta: 30 }, 1, G);
    expect(now(r)).toEqual(Am);
    r.lift();
    expect(r.timers.map((t) => t.ms)).toEqual([1000]);
    expect(r.core.views.readout.get().name).toBe("Am");
  });
  it("the swiped chord takes the pressed chord's place in the trail", () => {
    const r = rig();
    r.press(G);
    r.lift();
    land(r, C);
    to(r, { r: 150, theta: 0 });
    expect(r.core.views.circle.get().trail).toEqual([G, Am]);
  });
  it("and sounds the same as pressing that chord instead", () => {
    const swiped = rig();
    swiped.press(G);
    swiped.lift();
    land(swiped, C);
    to(swiped, { r: 150, theta: 0 });
    const pressed = rig();
    pressed.press(G);
    pressed.lift();
    pressed.press(Am);
    expect(swiped.core.state.get().sounding).toEqual(pressed.core.state.get().sounding);
    expect(swiped.core.state.get().history.map((h) => h.voiced)).toEqual(pressed.core.state.get().history.map((h) => h.voiced));
  });
  it("its stars are the swiped chord's", () => {
    const r = rig();
    land(r, C);
    to(r, { r: 150, theta: 0 });
    const direct = rig();
    direct.press(Am);
    expect(r.core.views.circle.get().next).toEqual(direct.core.views.circle.get().next);
  });
  it("a latch applies, as it would to a press", () => {
    const r = rig();
    r.core.send({ type: "padDown", pad: "7", pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
    land(r, C);
    to(r, { r: 150, theta: 0 });
    expect(r.core.views.readout.get().name).toBe("Am7");
  });
  it("another finger's movement doesn't swipe", () => {
    const r = rig();
    land(r, C);
    to(r, { r: 150, theta: 0 }, 2);
    expect(now(r)).toEqual(C);
  });
});

describe("a chord's shape on the circle", () => {
  const shape = (r: ReturnType<typeof rig>) => r.core.views.circle.get().shape;
  it("C and C minor are mirror images: columns 0, 1, 4 and 0, 1, 9", () => {
    const r = rig();
    r.press(C);
    expect([...shape(r)!.now].sort((a, b) => a - b)).toEqual([0, 1, 4]);
    r.lift();
    r.press(Cm);
    expect([...shape(r)!.now].sort((a, b) => a - b)).toEqual([0, 1, 9]);
  });
  it("marks what stayed", () => {
    const r = rig();
    r.press(C);
    r.lift();
    r.press({ ring: "min", col: 0 }); // Am shares C and E
    expect([...shape(r)!.kept].sort((a, b) => a - b)).toEqual([0, 4]);
    expect([...shape(r)!.before].sort((a, b) => a - b)).toEqual([0, 1, 4]);
  });
  it("is empty in silence", () => {
    const r = rig();
    expect(shape(r)).toBeNull();
    r.press(C);
    r.core.silence();
    expect(shape(r)).toBeNull();
  });
});

describe("space", () => {
  it("starts as a room, changes, saves, and tells the sound", () => {
    const spaces: string[] = [];
    const saved: string[] = [];
    const sound: Sound = { apply: () => {}, useEngine: () => {}, useModel: () => {}, useSpace: (s) => spaces.push(s) };
    const core = createCore({ catalog: [], sound, onSettings: (s) => saved.push(s.space) });
    expect(core.views.menu.get().space).toBe("room");
    core.send({ type: "spaceChanged", space: "hall" });
    core.send({ type: "spaceChanged", space: "hall" }); // the same again does nothing
    core.send({ type: "spaceChanged", space: "off" });
    expect(spaces).toEqual(["hall", "off"]);
    expect(saved).toEqual(["hall", "off"]);
  });
  it("changing it never stops what's sounding", () => {
    const r = rig();
    r.press(C);
    r.sent.length = 0;
    r.core.send({ type: "spaceChanged", space: "hall" });
    expect(r.sent).toEqual([]);
    expect(r.core.state.get().sounding).not.toBeNull();
  });
});

describe("what the star atlas needs from the views", () => {
  it("the readout carries the function, the key, how far the voices moved, and audio health", () => {
    const r = rig();
    expect(r.core.views.readout.get()).toMatchObject({ name: "", fn: null, key: { name: "C", mode: "major" }, moved: null, audioOk: true });
    r.press(C);
    r.lift();
    r.press(G);
    const v = r.core.views.readout.get();
    expect(v).toMatchObject({ name: "G", fn: "dominant" });
    expect(v.moved).toBe(r.core.views.ribbon.get().cost);
    r.core.setAudio(false);
    expect(r.core.views.readout.get().audioOk).toBe(false);
  });
  it("the circle and readout know whether the chord is still sounding, or only the last played", () => {
    const r = rig();
    r.press(G);
    expect(r.core.views.circle.get().sounding).toBe(true);
    r.lift();
    expect(r.core.views.readout.get().sounding).toBe(true); // ringing on
    r.fireTimers();
    expect(r.core.views.circle.get()).toMatchObject({ sounding: false, current: G });
    expect(r.core.views.readout.get()).toMatchObject({ sounding: false, name: "G" });
  });
  it("the left column lists the same next chords as the ribbon", () => {
    const r = rig();
    r.press(G);
    expect(r.core.views.controls.get().next).toEqual(r.core.views.ribbon.get().next);
    expect(r.core.views.controls.get().next.map((n) => n.name)).toEqual(["C", "Am", "F"]);
  });
  it("the pads know the chord they act on", () => {
    const r = rig();
    expect(r.core.views.alterations.get().chordName).toBe("");
    r.press(G);
    expect(r.core.views.alterations.get().chordName).toBe("G");
  });
  it("the Menu offers Next chords", () => {
    const r = rig();
    expect(r.core.views.menu.get()).toMatchObject({ preset: "pop" });
    expect(r.core.views.menu.get().presets.map((p) => p.short)).toEqual(["Modern", "Classic", "Jazz"]);
  });
});

describe("named shapes in the views", () => {
  const Am: ChordRef = { ring: "min", col: 0 };
  const Dm: ChordRef = { ring: "min", col: -1 };
  const F: ChordRef = { ring: "maj", col: -1 };
  const play = (r: ReturnType<typeof rig>, ...refs: ChordRef[]) => refs.forEach((ref) => (r.press(ref), r.lift()));

  it("Dm, G, C names ii–V–I beside C, and brackets it in the trail", () => {
    const r = rig();
    play(r, Dm, G, C);
    expect(r.core.views.readout.get().shape).toEqual({ numerals: "ii–V–I", name: "two-five-one", where: null });
    expect(r.core.views.ribbon.get().shapes).toEqual([{ from: 0, to: 2, short: "TWO-FIVE-ONE", now: true }]);
    play(r, Am, Dm, G, C);
    expect(r.core.views.readout.get().shape?.numerals).toBe("vi–ii–V–I");
  });

  it("names a shape only beside the chord that completes it; the bracket stays, dim", () => {
    const r = rig();
    play(r, Dm, G, C, F);
    expect(r.core.views.readout.get().shape).toBeNull();
    expect(r.core.views.ribbon.get().shapes).toEqual([{ from: 0, to: 2, short: "TWO-FIVE-ONE", now: false }]);
  });

  it("a 7th from a pad doesn't hide the shape, and Dm then Dm7 is one step of it", () => {
    const r = rig();
    play(r, Dm);
    r.core.send({ type: "padDown", pad: "7", pointer: 5 });
    play(r, G);
    r.core.send({ type: "padUp", pointer: 5 });
    play(r, C);
    expect(r.core.views.ribbon.get().columns.map((c) => c.name)).toEqual(["Dm", "Dm7", "G7", "C"]); // the pad caught Dm still ringing
    expect(r.core.views.readout.get().shape?.numerals).toBe("ii–V–I");
    expect(r.core.views.ribbon.get().shapes[0]).toMatchObject({ from: 0, to: 3 });
  });

  it("Clear forgets the shapes with the trail", () => {
    const r = rig();
    play(r, Dm, G, C);
    r.fireTimers();
    r.core.send({ type: "trailCleared" });
    expect(r.core.views.ribbon.get().shapes).toEqual([]);
  });
});

describe("7 in key", () => {
  const Dm: ChordRef = { ring: "min", col: 11 };
  const seven = (r: ReturnType<typeof rig>) => r.core.send({ type: "sevenInKeyToggled" });
  const tap = (r: ReturnType<typeof rig>, pad: Alteration) => {
    r.core.send({ type: "padDown", pad, pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
  };
  const top = (r: ReturnType<typeof rig>) => r.core.state.get().current?.alts.top;

  it("gives each chord its own 7th, and names the circle to match", () => {
    const r = rig();
    seven(r);
    r.press(C);
    expect(top(r)).toBe("maj7");
    r.lift();
    r.press(G);
    expect(top(r)).toBe("7");
    r.lift();
    r.press(Dm);
    expect(r.core.views.readout.get().name).toBe("Dm7");
    const cells = r.core.views.circle.get().chords;
    expect(cells.find((c) => c.plain === "C")).toMatchObject({ name: "Cmaj7", numeral: "I" });
    expect(cells.find((c) => c.plain === "E")?.name).toBe("E7");
    expect(r.core.views.circle.get().relabeled).toBe(true);
  });

  it("applies at once to a chord that's sounding, and comes off it", () => {
    const r = rig();
    r.press(Dm);
    expect(top(r)).toBeNull();
    seven(r);
    expect(top(r)).toBe("7");
    expect(r.core.views.alterations.get().sevenChord).toBe("Dm7");
    seven(r);
    expect(top(r)).toBeNull();
  });

  it("leaves the 7 pad unringed, since the mode put the 7th there", () => {
    const r = rig();
    seven(r);
    r.press(Dm);
    const seven7 = r.core.views.alterations.get().options.find((o) => o.id === "7")!;
    expect(seven7).toMatchObject({ on: false, chord: "Dm7" });
    expect(r.core.views.alterations.get().options.find((o) => o.id === "maj7")?.on).toBe(false);
  });

  it("lets a tapped 7th or 9th pad replace it, and lifts back to it", () => {
    const r = rig();
    seven(r);
    r.press(C);
    tap(r, "9");
    expect(top(r)).toBe("9");
    expect(r.core.state.get().latched.top).toBe("9");
    tap(r, "9");
    expect(top(r)).toBe("maj7");
    expect(r.core.state.get().latched.top).toBeNull();
  });

  it("wins over a loaded shape's color", () => {
    const r = rig();
    r.core.send({ type: "shapeChosen", shape: "axis" });
    seven(r);
    r.press(C);
    expect(top(r)).toBe("maj7");
  });

  it("combines with a sus pad", () => {
    const r = rig();
    seven(r);
    tap(r, "sus4");
    r.press(G);
    expect(r.core.views.readout.get().name).toBe("G7sus4");
  });

  it("is saved with the other settings", () => {
    const saved: boolean[] = [];
    const sound: Sound = { apply: () => {}, useEngine: () => {}, useModel: () => {} };
    const core = createCore({ catalog: [], sound, onSettings: (s) => saved.push(s.sevenInKey) });
    core.send({ type: "sevenInKeyToggled" });
    expect(saved).toEqual([true]);
  });
});

describe("a progression loaded from the library", () => {
  const Am: ChordRef = { ring: "min", col: 0 };
  const Dm: ChordRef = { ring: "min", col: 11 };
  const play = (r: ReturnType<typeof rig>, ...refs: ChordRef[]) => refs.forEach((ref) => (r.press(ref), r.lift()));

  it("is offered in the Menu, and drawn where it falls in the key", () => {
    const r = rig();
    expect(r.core.views.menu.get().shapes.map((s) => s.label)).toEqual(["ii–V–I", "Circle", "Axis", "Andalusian", "Doo-wop", "Canon", "Blues", "Ragtime", "Rock"]);
    expect(r.core.views.circle.get().loaded).toBeNull();
    r.core.send({ type: "shapeChosen", shape: "circle" });
    expect(r.core.views.menu.get().shape).toBe("circle");
    // With its 7ths, as it's usually played: each step names the pad and the chord it makes.
    expect(r.core.views.circle.get().loaded).toEqual({
      numerals: "vi7–ii7–V7–Imaj7",
      name: "circle progression",
      where: "C major",
      steps: [
        { ref: Am, numeral: "vi", top: "7", name: "Am7" },
        { ref: Dm, numeral: "ii", top: "7", name: "Dm7" },
        { ref: G, numeral: "V", top: "7", name: "G7" },
        { ref: C, numeral: "I", top: "maj7", name: "Cmaj7" },
      ],
      played: 0,
    });
    // Plain, from the Menu: triads, and the setting is one that's saved.
    expect(r.core.views.menu.get().colored).toBe(true);
    r.core.send({ type: "shapeColored", colored: false });
    expect(r.core.views.menu.get().colored).toBe(false);
    expect(r.core.views.circle.get().loaded?.numerals).toBe("vi–ii–V–I");
    expect(r.core.views.circle.get().loaded?.steps.map((s) => s.name)).toEqual(["Am", "Dm", "G", "C"]);
  });

  it("names the axis's add9 and the Andalusian's V7, in any key", () => {
    const sound: Sound = { apply: () => {}, useEngine: () => {}, useModel: () => {} };
    const core = createCore({ catalog: [], sound, initial: { key: { col: 3, mode: "major" }, loaded: "axis" } });
    expect(core.views.circle.get().loaded?.numerals).toBe("Iadd9–V–vi7–IVmaj7");
    expect(core.views.circle.get().loaded?.steps.map((s) => s.name)).toEqual(["Aadd9", "E", "F♯m7", "Dmaj7"]);
    core.send({ type: "shapeChosen", shape: "andalusian" });
    expect(core.views.circle.get().loaded?.numerals).toBe("i–♭VII–♭VI–V7");
    expect(core.views.circle.get().loaded?.steps.at(-1)?.name).toBe("C♯7");
    core.send({ type: "shapeChosen", shape: "two-five-one" });
    expect(core.views.circle.get().loaded?.steps.map((s) => s.name)).toEqual(["Bm7", "E7", "Amaj7"]);
  });

  it("saves whether shapes are colored, with the other settings", () => {
    const saved: boolean[] = [];
    const sound: Sound = { apply: () => {}, useEngine: () => {}, useModel: () => {} };
    const core = createCore({ catalog: [], sound, onSettings: (s) => saved.push(s.colored) });
    core.send({ type: "shapeColored", colored: false });
    core.send({ type: "shapeColored", colored: false }); // no change, nothing saved
    expect(saved).toEqual([false]);
  });

  it("a press on the shape's next step plays it as the shape writes it", () => {
    const names = (r: ReturnType<typeof rig>) => r.core.views.ribbon.get().columns.map((c) => c.name);
    const r = rig();
    r.core.send({ type: "shapeChosen", shape: "two-five-one" });
    play(r, Dm, G, C);
    expect(names(r)).toEqual(["Dm7", "G7", "Cmaj7"]);
    // Only the step that's next: Am isn't in the shape, so it's plain.
    const q = rig();
    q.core.send({ type: "shapeChosen", shape: "two-five-one" });
    play(q, Am, Dm);
    expect(names(q)).toEqual(["Am", "Dm7"]);
    q.press(Dm); // the step just played, pressed again, stays itself
    expect(q.core.state.get().current?.alts.top).toBe("7");
    q.lift();
    // Plain shapes, or none loaded: plain chords.
    const p = rig();
    p.core.send({ type: "shapeChosen", shape: "two-five-one" });
    p.core.send({ type: "shapeColored", colored: false });
    play(p, Dm, G);
    expect(names(p)).toEqual(["Dm", "G"]);
    const n = rig();
    play(n, Dm, G);
    expect(names(n)).toEqual(["Dm", "G"]);
  });

  it("tapping off the pad a shape put on a chord leaves that step plain, and latches nothing", () => {
    const tapAdd9 = (r: ReturnType<typeof rig>) => {
      r.core.send({ type: "padDown", pad: "add9", pointer: 20 });
      r.core.send({ type: "padUp", pointer: 20 });
    };
    const r = rig();
    r.core.send({ type: "shapeChosen", shape: "axis" });
    r.press(C);
    expect(r.core.state.get().current?.alts.top).toBe("add9");
    tapAdd9(r);
    expect(r.core.state.get().current?.alts.top).toBeNull();
    expect(r.core.state.get().latched.top).toBeNull();
    r.lift();
    // It stays off for that step, on the circle and under the finger, and the other chords aren't touched.
    expect(r.core.views.circle.get().loaded?.steps[0]).toMatchObject({ top: "", name: "C" });
    r.press(C);
    expect(r.core.state.get().current?.alts.top).toBeNull();
    r.lift();
    play(r, G, Am);
    expect(r.core.views.ribbon.get().columns.map((c) => c.name).slice(-3)).toEqual(["C", "G", "Am7"]);
    // A second tap on that chord brings it back, still without latching.
    r.press(C);
    tapAdd9(r);
    expect(r.core.state.get().current?.alts.top).toBe("add9");
    expect(r.core.state.get().latched.top).toBeNull();
    r.lift();
    expect(r.core.views.circle.get().loaded?.steps[0]).toMatchObject({ top: "add9", name: "Cadd9" });
    // Reloading the shape starts it over.
    r.press(C);
    tapAdd9(r);
    r.lift();
    r.core.send({ type: "shapeChosen", shape: null });
    r.core.send({ type: "shapeChosen", shape: "axis" });
    expect(r.core.views.circle.get().loaded?.steps[0]).toMatchObject({ top: "add9" });
  });

  it("tapping a shape's pad off a chord it comes back to takes it off every time that chord comes up", () => {
    const r = rig();
    r.core.send({ type: "shapeChosen", shape: "blues" });
    r.press(C);
    r.core.send({ type: "padDown", pad: "7", pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
    r.lift();
    expect(r.core.views.circle.get().loaded?.numerals).toBe("I–IV7–I–V7–IV7");
    expect(r.core.state.get().latched.top).toBeNull();
  });

  it("a latched 7th or 9th pad wins over the shape's, and the next chord is named for it", () => {
    const r = rig();
    r.core.send({ type: "shapeChosen", shape: "two-five-one" });
    r.core.send({ type: "padDown", pad: "7", pointer: 20 });
    r.core.send({ type: "padUp", pointer: 20 });
    play(r, Dm, G);
    const next = r.core.views.circle.get().loaded!;
    expect(next.steps[next.played]).toMatchObject({ top: "maj7", name: "C7" });
    play(r, C);
    expect(r.core.views.ribbon.get().columns.at(-1)?.name).toBe("C7");
    // A sus pad latched still takes the shape's 7th: G7sus4.
    const q = rig();
    q.core.send({ type: "shapeChosen", shape: "two-five-one" });
    play(q, Dm);
    q.core.send({ type: "padDown", pad: "sus4", pointer: 20 });
    q.core.send({ type: "padUp", pointer: 20 });
    play(q, G);
    expect(q.core.views.ribbon.get().columns.at(-1)?.name).toBe("G7sus4");
  });

  it("follows a colored shape whatever pads are used: the chords count, not their 7ths", () => {
    const r = rig();
    r.core.send({ type: "shapeChosen", shape: "two-five-one" });
    play(r, Dm);
    expect(r.core.views.circle.get().loaded?.played).toBe(1);
  });

  it("turns with the key: the same shape, rotated", () => {
    const sound: Sound = { apply: () => {}, useEngine: () => {}, useModel: () => {} };
    const core = createCore({ catalog: [], sound, initial: { key: { col: 3, mode: "major" }, loaded: "circle" } });
    const loaded = core.views.circle.get().loaded!;
    expect(loaded.where).toBe("A major");
    expect(loaded.steps.map((s) => s.ref)).toEqual([
      { ring: "min", col: 3 }, // F♯m
      { ring: "min", col: 2 }, // Bm
      { ring: "maj", col: 4 }, // E
      { ring: "maj", col: 3 }, // A
    ]);
    // The Andalusian descent, from a major key, is drawn in its relative minor.
    core.send({ type: "shapeChosen", shape: "andalusian" });
    expect(core.views.circle.get().loaded?.where).toBe("F♯ minor");
  });

  it("follows the trail: how many steps have just been played in order", () => {
    const r = rig();
    r.core.send({ type: "shapeChosen", shape: "circle" });
    play(r, C, Am);
    expect(r.core.views.circle.get().loaded?.played).toBe(1);
    play(r, Dm);
    expect(r.core.views.circle.get().loaded?.played).toBe(2);
    play(r, G, C);
    expect(r.core.views.circle.get().loaded?.played).toBe(0); // done: back to the start
  });

  it("puts away", () => {
    const r = rig();
    r.core.send({ type: "shapeChosen", shape: "axis" });
    r.core.send({ type: "shapeChosen", shape: null });
    expect(r.core.views.circle.get().loaded).toBeNull();
    expect(r.core.views.menu.get().shape).toBeNull();
  });
});
