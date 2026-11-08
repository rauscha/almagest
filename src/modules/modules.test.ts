// @vitest-environment happy-dom
/**
 * Any chunk can be thrown out and rebuilt alone. These tests are what make that true instead
 * of a good intention, so a failure here means the structure has broken, not the test.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { flushSync, mount, unmount, type Component } from "svelte";
import App from "../app/App.svelte";
import { createCore, type Sound } from "../core/core";
import type { Intent, Slot } from "../core/contract";
import type { VoiceCommand } from "../core/reduce";
import { atlas, skins, type Modules } from "../skins/skins";
import { atom } from "nanostores";
import { CATALOG } from "../voices/catalog";
import { RING_CHOICES } from "../core/reduce";
import Stub from "./_stubs/Stub.svelte";

const SRC = resolve(__dirname, "..");
function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesIn(p) : [p];
  });
}
const code = (dir: string) => filesIn(join(SRC, dir)).filter((p) => /\.(ts|svelte)$/.test(p) && !p.endsWith(".test.ts"));
const importsOf = (file: string) =>
  // Anywhere on a line, and dynamic imports too, so a stray import can't hide from this.
  [...readFileSync(file, "utf8").matchAll(/\bimport\b\s*(type\s+)?[^"';]*?["']([^"']+)["']/g)].map((m) => ({
    typeOnly: !!m[1],
    spec: m[2],
  }));

const SLOTS: Slot[] = ["circle", "readout", "controls", "menu", "alterations", "ribbon", "practice"];
/** Each real module once, however many looks use it. */
const realModules = [
  ...new Map(
    skins.flatMap((skin) =>
      (Object.entries(skin.modules) as [Slot, Component<any>][])
        .filter(([, m]) => m !== Stub)
        .map(([slot, m]) => [m, [slot, m]] as const),
    ),
  ).values(),
];

describe("dependencies.test: who may import what", () => {
  it("a module imports only the contract and its own folder", () => {
    for (const file of code("modules")) {
      const folder = relative(join(SRC, "modules"), file).split(/[\\/]/)[0];
      for (const { spec, typeOnly } of importsOf(file)) {
        const ok =
          spec === "svelte" ||
          spec === "../../core/contract" ||
          spec.startsWith("./") ||
          (spec === "nanostores" && typeOnly);
        expect(ok, `${relative(SRC, file)} (folder ${folder}) imports ${spec}`).toBe(true);
      }
    }
  });
  it("theory has no UI or audio", () => {
    for (const file of code("theory")) {
      const text = readFileSync(file, "utf8");
      for (const { spec } of importsOf(file)) expect(spec.startsWith("./"), `${file} imports ${spec}`).toBe(true);
      expect(text, file).not.toMatch(/\b(window|document|AudioContext|AudioNode)\b/);
    }
  });
  it("core knows nothing of modules, skins, voices or Parallax", () => {
    for (const file of code("core")) {
      for (const { spec } of importsOf(file)) {
        expect(/modules|skins|voices|vendor|svelte/.test(spec), `${file} imports ${spec}`).toBe(false);
      }
    }
  });
  it("only the voices and the app touch audio", () => {
    const allowed = /[\\/](voices|app)[\\/]/;
    for (const file of filesIn(SRC).filter((p) => /\.(ts|svelte)$/.test(p) && !p.endsWith(".test.ts"))) {
      if (allowed.test(file)) continue;
      expect(readFileSync(file, "utf8"), file).not.toMatch(/\b(AudioContext|AudioWorkletNode|createGain)\b/);
    }
  });
  it("no visible label carries a forbidden brand name", () => {
    const forbidden = /Mutable|Braids|Plaits|\bRings\b/;
    for (const dir of ["modules", "skins", "app"]) {
      for (const file of code(dir)) expect(readFileSync(file, "utf8"), file).not.toMatch(forbidden);
    }
    for (const e of CATALOG) for (const label of [e.label, ...e.models]) expect(label).not.toMatch(forbidden);
  });
});

function coreWith() {
  const log: VoiceCommand[][] = [];
  const sound: Sound = { apply: (c) => void (c.length && log.push(c)), useEngine: () => {}, useModel: () => {} };
  const core = createCore({ catalog: CATALOG, sound, setTimer: () => {} });
  return { core, log };
}

const touch = (phase: "down" | "up", pointer: number, ring: "maj" | "min" | "dim" | null = null, col = 0): Intent => ({
  type: "touch", phase, pointer, ref: ring ? { ring, col } : null, r: 0, theta: 0, time: 0,
});
const SCRIPT: Intent[] = [
  touch("down", 1, "maj", 0), touch("up", 1),
  touch("down", 1, "min", 9), touch("up", 1),
  touch("down", 2, "maj", 1), touch("down", 3, "min", 1), touch("up", 3), touch("up", 2),
  touch("down", 1, "dim", 0), touch("up", 1),
  { type: "sustainToggled" },
  touch("down", 1, "maj", 11), touch("up", 1),
  { type: "sustainToggled" },
];

function play(modules: Modules) {
  const { core, log } = coreWith();
  const app = mount(App, {
    target: document.body,
    props: { core, look: atom({ modules }), start: async () => {} },
  });
  flushSync();
  for (const intent of SCRIPT) {
    core.send(intent);
    flushSync();
  }
  unmount(app);
  return log;
}

describe("swap.test: any chunk can be replaced alone", () => {
  const baseline = play(atlas.modules);

  it("the script makes sound", () => {
    expect(baseline.length).toBeGreaterThan(4);
  });
  for (const slot of SLOTS) {
    it(`a stub for ${slot} changes no sound`, () => {
      expect(play({ ...atlas.modules, [slot]: Stub })).toEqual(baseline);
    });
  }
  it("stubs for everything at once change no sound", () => {
    const all = Object.fromEntries(SLOTS.map((s) => [s, Stub])) as unknown as Modules;
    expect(play(all)).toEqual(baseline);
  });
});

describe("the star atlas", () => {
  it("is the one look, with every slot", () => {
    expect(skins.map((s) => s.id)).toEqual(["atlas"]);
    for (const slot of SLOTS) expect(atlas.modules[slot], slot).toBeTruthy();
  });
  it("defines every color its modules ask for", () => {
    const files = ["circle/AtlasCircle", "readout/AtlasReadout", "controls/AtlasControls", "menu/AtlasMenu", "alterations/AtlasPads", "ribbon/KeysRibbon"];
    const asked = [...new Set(files.flatMap((f) => [...readFileSync(join(SRC, `modules/${f}.svelte`), "utf8").matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1])))];
    expect(asked.length).toBeGreaterThan(5);
    for (const token of asked) expect(atlas.tokens[token], token).toBeTruthy();
  });
  it("offers every chord to touch, and the hub as the one key handle", () => {
    const { core } = coreWith();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const m = mount(atlas.modules.circle, { target, props: { view: core.views.circle, send: () => {} } });
    flushSync();
    expect(target.querySelectorAll("[data-ring]")).toHaveLength(25);
    expect(target.querySelectorAll("[data-head]")).toHaveLength(1);
    unmount(m);
    target.remove();
  });
  it("the app wears its layout, with no look switcher and no Full button", () => {
    const { core } = coreWith();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const m = mount(App, { target, props: { core, look: atom({ modules: atlas.modules, slots: atlas.slots }), start: async () => {} } });
    flushSync();
    expect(target.querySelector<HTMLElement>('[data-slot="alterations"]')!.style.top).toBe(`${atlas.slots!.alterations![1]}px`);
    expect(target.querySelector('[aria-label="Next look"]')).toBeNull();
    expect([...target.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Full")).toBe(false);
    unmount(m);
    target.remove();
  });
});

describe("contract.test: every real module behaves", () => {
  const KNOWN = new Set(["touch", "padDown", "padUp", "menuToggled", "trailCleared", "presetChanged", "spaceChanged", "sustainToggled", "sevenInKeyToggled", "midiOutputPressed", "midiOffPressed", "midiChannelStepped", "ownSoundToggled", "spreadChanged", "slideToggled", "slideTimeChanged", "ringChanged", "engineChanged", "modelChanged"]);

  for (const [slot, Module] of realModules) {
    it(`${slot} mounts, updates, and leaves nothing behind`, () => {
      const { core } = coreWith();
      const sent: Intent[] = [];
      const send = (i: Intent) => {
        sent.push(i);
        core.send(i);
      };
      const target = document.createElement("div");
      document.body.appendChild(target);
      const m = mount(Module, { target, props: { view: core.views[slot], send } });
      flushSync();
      expect(target.children.length).toBeGreaterThan(0);
      const before = target.innerHTML;
      core.send(touch("down", 9, "maj", 1));
      flushSync();
      if (slot !== "menu") expect(target.innerHTML).not.toBe(before);
      for (const i of sent) expect(KNOWN.has(i.type), i.type).toBe(true);

      unmount(m);
      sent.length = 0;
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9 }));
      expect(sent, "listeners left behind").toEqual([]);
      target.remove();
    });
  }

  const mounted = (slot: Slot, Module: Component<any>, opts: { fired?: (() => void)[] } = {}) => {
    const fired = opts.fired;
    const { core, log } = fired ? (() => {
      const log: VoiceCommand[][] = [];
      const sound: Sound = { apply: (c) => void (c.length && log.push(c)), useEngine: () => {}, useModel: () => {} };
      return { core: createCore({ catalog: CATALOG, sound, setTimer: (fn) => void fired.push(fn) }), log };
    })() : coreWith();
    const sent: Intent[] = [];
    const target = document.createElement("div");
    document.body.appendChild(target);
    const m = mount(Module, {
      target,
      props: { view: core.views[slot], send: (i: Intent) => { sent.push(i); core.send(i); } },
    });
    flushSync();
    const button = (text: string) => [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
    const click = (text: string) => { button(text).click(); flushSync(); };
    return { core, log, sent, target, button, click, done: () => { unmount(m); target.remove(); } };
  };

  it("the circle reports the chord under a finger, and leaves meaning to core", () => {
    const { target, sent, done } = mounted("circle", atlas.modules.circle);
    const cell = target.querySelector('[data-chord="G"]')!;
    expect(cell).toBeTruthy();
    cell.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 4, bubbles: true }));
    expect(sent[0]).toMatchObject({ type: "touch", phase: "down", pointer: 4, ref: { ring: "maj", col: 1 } });
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 4 }));
    expect(sent[1]).toMatchObject({ type: "touch", phase: "up", pointer: 4 });
    done();
  });

  it("a touch on the hub is the key dial, whatever's under it, and plays nothing", () => {
    const { target, sent, log, done } = mounted("circle", atlas.modules.circle);
    expect(target.querySelector(".mode-line")).toBeNull();
    target.querySelector("[data-head]")!.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 4, bubbles: true }));
    expect(sent[0]).toMatchObject({ type: "touch", phase: "down", pointer: 4, head: true, ref: null });
    flushSync();
    expect(log).toEqual([]);
    expect(target.querySelector(".mode-line")).toBeTruthy(); // the major/minor line shows on touch
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 4 }));
    flushSync();
    expect(target.querySelector(".mode-line")).toBeNull();
    done();
  });

  it("every likely next chord gets a star, larger and brighter for likelier, for as long as the chord sounds", () => {
    const fired: (() => void)[] = [];
    const { core, target, done } = mounted("circle", atlas.modules.circle, { fired });
    core.send(touch("down", 1, "maj", 1)); // G
    flushSync();
    const stars = [...target.querySelectorAll<SVGCircleElement>(".star.next[data-p]")]
      .map((e) => ({ p: Number(e.dataset.p), r: Number(e.getAttribute("r")), lum: luminance(e.style.fill) }))
      .sort((a, b) => b.p - a.p);
    expect(stars.length).toBeGreaterThan(3);
    for (let i = 1; i < stars.length; i++) {
      expect(stars[i].r).toBeLessThanOrEqual(stars[i - 1].r);
      expect(stars[i].lum).toBeLessThanOrEqual(stars[i - 1].lum);
    }
    expect(stars[0].lum).toBeGreaterThan(stars.at(-1)!.lum);
    expect(target.querySelectorAll(".arrow, .arrow-head, line.suggest")).toHaveLength(0); // no lines across the circle
    core.send(touch("up", 1));
    flushSync();
    expect(target.querySelectorAll(".star.next[data-p]").length).toBe(stars.length); // still ringing
    fired.splice(0).forEach((f) => f());
    flushSync();
    expect(target.querySelectorAll(".star.next[data-p]")).toHaveLength(0);
    done();
  });

  it("the circle marks function by line style alone, on every in-key cell", () => {
    const { target, done } = mounted("circle", atlas.modules.circle);
    const slits = [...target.querySelectorAll("path.slit")].map((s) => s.getAttribute("stroke-dasharray"));
    expect(slits.filter((d) => d === "5 3.2").length).toBe(2); // ii, IV
    expect(slits.filter((d) => d === "0.1 3.4").length).toBe(3); // V, vii°, half of iii
    expect(slits.length).toBe(8); // seven cells, with iii drawn in two halves
    done();
  });

  it("the left column lists the top three with odds, and marks an estimate as one", () => {
    const fired: (() => void)[] = [];
    const { core, target, done } = mounted("controls", atlas.modules.controls, { fired });
    const rows = () => [...target.querySelectorAll(".row .name")].map((n) => n.textContent);
    const odds = () => [...target.querySelectorAll(".row")].map((r) => r.querySelectorAll(".val")[0]?.textContent);
    core.send(touch("down", 1, "maj", 1)); // V
    flushSync();
    expect(rows()).toEqual(["C", "Am", "F"]);
    expect(odds()[0]).toMatch(/^\d+%$/); // counted, so no ~
    expect(target.textContent).not.toContain("estimated");
    core.send(touch("up", 1));
    fired.splice(0).forEach((f) => f()); // the ring ends
    flushSync();
    expect(rows()).toEqual([]);
    core.send({ type: "presetChanged", preset: "classic" });
    core.send(touch("down", 1, "min", 4)); // C♯m in C: too rare in the classic counts for a row
    flushSync();
    expect(odds().every((v) => v!.startsWith("~"))).toBe(true);
    expect(target.textContent).toContain("~ estimated, not measured");
    done();
  });

  it("the voices light the keys of what's sounding, and name it; the readout says how far they moved", () => {
    const { core, target, done } = mounted("ribbon", atlas.modules.ribbon);
    expect(target.querySelectorAll(".key.lit")).toHaveLength(0);
    core.send(touch("down", 1, "maj", 0));
    flushSync();
    expect(target.querySelectorAll(".key.lit")).toHaveLength(5); // four upper voices and the bass
    expect([...target.querySelectorAll(".note")].map((n) => n.textContent)).toEqual(["C4", "E4", "G4", "C5", "C3"]);
    core.send(touch("up", 1));
    core.send(touch("down", 1, "min", 9)); // C minor: only the 3rd moves
    flushSync();
    expect([...target.querySelectorAll(".note:not(.held)")].map((n) => n.textContent)).toEqual(["E♭4"]);
    done();
    const r = mounted("readout", atlas.modules.readout);
    r.core.send(touch("down", 1, "maj", 0));
    r.core.send(touch("up", 1));
    r.core.send(touch("down", 1, "min", 9));
    flushSync();
    expect(r.target.querySelector(".moved")?.textContent).toBe("Moved 1 semitone");
    r.done();
  });

  it("the left column's controls send only what they should", () => {
    const { core, target, click, done } = mounted("controls", atlas.modules.controls);
    const slider = target.querySelector<SVGElement>('[role="slider"]')!;
    const press = (key: string) => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      flushSync();
    };
    press("ArrowLeft");
    press("ArrowLeft");
    expect(core.state.get().spread).toBe("close");
    press("ArrowLeft"); // already at the end
    expect(core.state.get().spread).toBe("close");
    press("ArrowRight");
    expect(core.state.get().spread).toBe("open");
    expect(slider.getAttribute("aria-valuetext")).toBe("open");
    expect(target.querySelector("[data-spread-now]")?.textContent).toBe("Open");
    click("Menu");
    expect(core.state.get().menuOpen).toBe(true);
    click("Menu");
    expect(core.state.get().menuOpen).toBe(false);
    done();
  });

  it("the menu shows nothing until it's opened, then every setting, with Next chords and Clear trail", () => {
    const { core, target, button, click, done } = mounted("menu", atlas.modules.menu);
    expect(target.querySelectorAll("button")).toHaveLength(0);
    core.send({ type: "menuToggled" });
    flushSync();
    expect(button("Six-op FM")).toBeUndefined(); // too plucky for chord changes
    click("Multi-model");
    expect(core.state.get().engine).toBe("multi");
    const multi = CATALOG.find((e) => e.id === "multi")!;
    click(multi.models[3]); // every sound is one touch away
    expect(core.state.get().models.multi).toBe(3);
    expect(button(multi.models[3]).classList.contains("on")).toBe(true);
    click("Pad synth");
    click("Slow Sweep");
    expect(core.state.get().models.pad).toBe(CATALOG.find((e) => e.id === "pad")!.models.indexOf("Slow Sweep"));
    click("Jazz");
    expect(core.state.get().preset).toBe("jazz");
    click("Classic");
    expect(core.state.get().preset).toBe("classic");
    const offs = [...target.querySelectorAll("button")].filter((b) => b.textContent === "Off");
    expect(offs).toHaveLength(5); // next chords', the shape's, space's, ring's, then MIDI's
    offs[0].click();
    flushSync();
    expect(core.state.get().preset).toBeNull();
    click("Circle"); // a progression to draw on the circle
    expect(core.state.get().loaded).toBe("circle");
    offs[1].click();
    flushSync();
    expect(core.state.get().loaded).toBeNull();
    click("Plain"); // a loaded shape's chords plain, or with their 7ths and add9s
    expect(core.state.get().colored).toBe(false);
    click("With 7ths and add9s");
    expect(core.state.get().colored).toBe(true);
    click("Hall");
    expect(core.state.get().space).toBe("hall");
    offs[3].click();
    flushSync();
    expect(core.state.get().ringMs).toBe(0);
    click("150");
    expect(core.state.get().slideMs).toBe(150);
    click("Re-strike");
    expect(core.state.get().slide).toBe(false);
    click("80"); // a slide time is also the way back to sliding: one row
    expect(core.state.get().slide).toBe(true);
    expect(button("Previous look")).toBeUndefined(); // the atlas is the look now
    core.send(touch("down", 1, "maj", 0));
    core.send(touch("up", 1));
    core.send(touch("down", 1, "maj", 1));
    click("Clear trail");
    expect(core.views.ribbon.get().columns).toHaveLength(1);
    core.setAbout("Installed, fullscreen");
    flushSync();
    expect(target.textContent).toContain("Installed, fullscreen");
    click("Done");
    expect(core.state.get().menuOpen).toBe(false);
    expect(target.querySelectorAll("button")).toHaveLength(0);
    done();
  });

  it("by eye: a pad names the chord it gives, shaded in the key, and says out when it leaves", () => {
    const { core, target, done } = mounted("alterations", atlas.modules.alterations);
    const pad = (label: string) => [...target.querySelectorAll<HTMLButtonElement>(".pad")].find((b) => b.querySelector(".label")?.textContent === label)!;
    core.send(touch("down", 1, "maj", 1)); // G in C major
    flushSync();
    expect(pad("7").querySelector(".chord")!.textContent).toBe("G7");
    expect(pad("7").classList.contains("shaded")).toBe(true);
    expect(pad("maj7").querySelector(".chord")!.textContent).toBe("Gmaj7out");
    expect(pad("maj7").classList.contains("shaded")).toBe(false);
    expect(pad("Major").disabled).toBe(true); // G is already major
    expect(pad("Minor").querySelector(".out")).toBeTruthy();
    expect(target.textContent).toContain("ON G");
    done();
  });

  it("Sustain is on the circle, acts on touch, and wears a ring when on", () => {
    const { core, target, done } = mounted("circle", atlas.modules.circle);
    expect(target.querySelector(".sustain-ring")).toBeNull();
    target.querySelector(".sustain-disc")!.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 6, bubbles: true }));
    flushSync();
    expect(core.state.get().sustain).toBe(true);
    expect(target.querySelector(".sustain-ring")).not.toBeNull();
    expect(core.state.get().current).toBeNull(); // the corner plays no chord
    done();
  });

  it("7 in key keeps the pads three by three, and wears a ring when on", () => {
    const { core, target, done } = mounted("alterations", atlas.modules.alterations);
    expect(target.querySelectorAll(".pads > .pad")).toHaveLength(9);
    const seven = target.querySelector<HTMLButtonElement>(".pad.seven")!;
    seven.click();
    flushSync();
    expect(core.state.get().sevenInKey).toBe(true);
    expect(seven.classList.contains("engaged")).toBe(true);
    done();
  });

  it("a pad acts on touch, latches, and reports its own lift and nobody else's", () => {
    const { core, log, sent, target, done } = mounted("alterations", atlas.modules.alterations);
    core.send(touch("down", 1, "maj", 1));
    flushSync();
    log.length = 0;
    const pad = [...target.querySelectorAll<HTMLElement>(".pad")].find((b) => b.querySelector(".label")?.textContent === "7")!;
    pad.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 5, bubbles: true }));
    expect(sent.at(-1)).toEqual({ type: "padDown", pad: "7", pointer: 5 });
    expect(log.length).toBe(1); // the 7th was heard at once
    flushSync();
    expect(pad.classList.contains("held")).toBe(true);
    const count = sent.length;
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })); // the chord's finger, not this pad's
    expect(sent.length).toBe(count);
    window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 5 }));
    expect(sent.at(-1)).toEqual({ type: "padUp", pointer: 5 });
    flushSync();
    expect(pad.classList.contains("engaged")).toBe(true);
    expect(pad.dataset.latched).toBe("true");
    done();
  });

  it("the voices mark the leading tone of a raised V", () => {
    const { core, target, done } = mounted("ribbon", atlas.modules.ribbon);
    core.send({ type: "touch", phase: "down", pointer: 7, ref: null, head: true, r: 212, theta: 0, time: 0 });
    core.send({ type: "touch", phase: "move", pointer: 7, ref: null, r: 100, theta: 0, ring: "min", time: 0 }); // A minor
    core.send({ type: "touch", phase: "up", pointer: 7, ref: null, r: 100, theta: 0, time: 0 });
    core.send(touch("down", 1, "min", 1)); // Em, the natural v
    flushSync();
    expect(target.textContent).not.toContain("LT");
    core.send({ type: "padDown", pad: "major", pointer: 3 });
    flushSync();
    expect([...target.querySelectorAll(".note")].map((n) => n.textContent)).toContain("G♯4 LT");
    done();
  });
});

/** Relative luminance of an rgb() fill, for checking brightness carries likelihood. */
function luminance(fill: string): number {
  const [r, g, b] = (fill.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
