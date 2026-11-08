import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
// The star atlas: a light serif for names and numerals, and Noto Music for ♭ ♯ 𝄪.
import "@fontsource/newsreader/latin-300.css";
import "@fontsource/newsreader/latin-300-italic.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-400-italic.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-500-italic.css";
import "@fontsource/noto-music/music-400.css";
import { atom } from "nanostores";
import { mount } from "svelte";
import { get, set } from "idb-keyval";
import App from "./App.svelte";
import { createCore, type Sound } from "../core/core";
import { CATALOG, engineKnobs, engineLevel, engineModelIndex } from "../voices/catalog";
import { Space } from "../voices/space";
import { makeEngine } from "../voices/engines";
import { VoiceBank } from "../voices/bank";
import { AudioKeeper, WATCH_MS } from "../voices/keeper";
import { atlas, type Skin } from "../skins/skins";
import { displayMode, registerUpdates, takeUpdate } from "./install";
import type { State } from "../core/reduce";

declare const __BUILD__: string;

function wear(skin: Skin) {
  document.documentElement.removeAttribute("style"); // or one look's tokens would leak into the next
  for (const [name, value] of Object.entries(skin.tokens)) document.documentElement.style.setProperty(name, value);
  return { modules: skin.modules, slots: skin.slots };
}

type Saved = Pick<State, "key" | "preset" | "space" | "engine" | "models" | "ringMs" | "spread" | "slide" | "slideMs" | "colored">;
// Bump this when a default or the sound list changes. Every change saves all settings, so an old
// default would otherwise stay stored and the new one would never reach a phone that's been used.
// The key keeps the app's old name, so installs from before the rename keep their settings.
const SETTINGS = "tend-settings-v4";
async function load(): Promise<Partial<Saved>> {
  try {
    const saved = await get<Saved & { revive?: unknown }>(SETTINGS);
    if (!saved) return {};
    const { revive: _gone, ...kept } = saved; // a setting that went with Six-op FM
    return kept;
  } catch {
    return {}; // private windows can refuse storage, and the defaults are fine
  }
}

let bank: VoiceBank | null = null;
const sound: Sound = {
  apply: (commands) => {
    if (commands.some((c) => c.kind === "on" || c.kind === "slide")) keeper.pressed();
    bank?.apply(commands);
  },
  useEngine: (engine, model) => void bank?.useEngine(engine, model),
  useModel: (model) => bank?.useModel(model),
  useSpace: (level) => space?.set(level),
};
let space: Space | null = null;

const saved = await load();
const core = createCore({
  catalog: CATALOG,
  sound,
  initial: saved,
  // `colored` came later; a v4 save without it takes the default, so the key needn't change.
  onSettings: ({ key, preset, space, engine, models, ringMs, spread, slide, slideMs, colored }) =>
    void set(SETTINGS, { key, preset, space, engine, models, ringMs, spread, slide, slideMs, colored }).catch(() => {}),
});

// The star atlas is the look.
const look = atom(wear(atlas));

/** One context and its voices. Called in the first tap, and again if the audio ever has to be rebuilt. */
async function build() {
  // `interactive` is what the tap-to-sound measurements used.
  const ctx = new AudioContext({ latencyHint: "interactive" });
  void ctx.resume().catch(() => {}); // right away, while this is still inside the tap
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  // A limiter's fast attack still lets the start of a loud note through, so leave room above it.
  const headroom = ctx.createGain();
  headroom.gain.value = HEADROOM;
  limiter.connect(headroom);
  headroom.connect(ctx.destination);
  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  headroom.connect(meter);
  const room = new Space(ctx, limiter);
  const s = core.state.get();
  room.set(s.space);
  const voices = new VoiceBank(ctx, makeEngine, engineModelIndex, room.input, engineLevel, engineKnobs);
  await voices.useEngine(s.engine, s.models[s.engine] ?? 0);
  return { ctx, meter, voices, room, headroom };
}
const HEADROOM = 0.8;

const keeper = new AudioKeeper({
  build,
  silence: core.silence,
  isVisible: () => document.visibilityState === "visible",
  // About 50 ms down to silence, well inside the wait before suspending; back up in a few ms with the note.
  mute: (on) => {
    const g = keeper.graph;
    if (g) g.headroom.gain.setTargetAtTime(on ? 0 : HEADROOM, g.ctx.currentTime, on ? 0.008 : 0.004);
  },
  onGraph: (graph) => {
    bank = graph?.voices ?? null;
    space = graph?.room ?? null;
  },
});

const wake = () => (document.visibilityState === "visible" ? keeper.visible() : keeper.hidden());
document.addEventListener("visibilitychange", wake);
addEventListener("pageshow", wake);
addEventListener("pagehide", () => keeper.hidden());
// Android opens the app switcher before it says the page is hidden; losing focus comes first.
addEventListener("blur", () => { if (started) keeper.away(); });
/** What the menu's last line says. It answers the first questions on the phone, with no tools needed. */
function about() {
  const ctx = keeper.graph?.ctx;
  const mode = displayMode();
  const state = ctx?.state ?? "not started";
  // Short enough for one line with every part showing; the menu cuts it off rather than wrap.
  const parts = [
    mode === "browser" ? "In a tab" : mode === "fullscreen" ? "Installed" : `Installed, ${mode}`,
    `build ${__BUILD__}`,
    state === "running" ? "audio on" : `audio ${state}`,
  ];
  if (keeper.lastResumeMs !== null) parts.push(`wake ${keeper.lastResumeMs} ms`);
  if (keeper.rebuilds) parts.push(`rebuilt ${keeper.rebuilds}`);
  return parts.join(" · ");
}
setInterval(() => {
  keeper.tick();
  core.setAbout(about());
  // The play screen says so when the sound isn't running while the app's in view, not just the Menu.
  const ctx = keeper.graph?.ctx;
  core.setAudio(!started || document.visibilityState !== "visible" || ctx?.state === "running");
}, WATCH_MS);

let started = false;
async function start() {
  // A newer version already downloaded is taken now, not after a whole session on this one. The
  // reload normally comes within a second; if it hasn't by the time the tap's permission to start sound
  // would run out, this version starts instead.
  if (takeUpdate()) await new Promise((r) => setTimeout(r, 3000));
  started = true;
  await keeper.start();
  if (new URLSearchParams(location.search).has("debug")) {
    Object.assign(window, {
      __almagest: {
        core,
        keeper,
        get ctx() { return keeper.graph?.ctx; },
        get meter() { return keeper.graph?.meter; },
      },
    });
  }
}

void registerUpdates(() => started);
mount(App, {
  target: document.getElementById("app")!,
  props: {
    core,
    look,
    start,
  },
});
