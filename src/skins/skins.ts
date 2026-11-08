/**
 * A skin is data: design tokens, plus which module fills each slot. So a skin can change
 * geometry as well as color, and Function must stay readable without color in every one.
 */
import type { Component } from "svelte";
import type { Slot } from "../core/contract";
import Stub from "../modules/_stubs/Stub.svelte";
import AtlasCircle from "../modules/circle/AtlasCircle.svelte";
import AtlasReadout from "../modules/readout/AtlasReadout.svelte";
import AtlasControls from "../modules/controls/AtlasControls.svelte";
import AtlasMenu from "../modules/menu/AtlasMenu.svelte";
import AtlasPads from "../modules/alterations/AtlasPads.svelte";
import KeysRibbon from "../modules/ribbon/KeysRibbon.svelte";

export type Modules = Record<Slot, Component<any>>;
/** Where a slot sits on the 998 × 448 stage: x, y, width, height. */
export type Box = [number, number, number, number];

export interface Skin {
  id: string;
  name: string;
  tokens: Record<string, string>;
  modules: Modules;
  /** Where this skin puts each slot, when it differs from the app's default layout. */
  slots?: Partial<Record<Slot, Box>>;
}

/**
 * The star atlas: a night chart. The key is a lit region, the likely next chords are brighter stars,
 * the trail is a constellation; voices sit beside a keyboard.
 */
export const atlas: Skin = {
  id: "atlas",
  name: "Star atlas",
  tokens: {
    "--ground": "#0A0F1D",
    "--chart": "#172038",
    "--chart-lo": "#121A2E",
    "--hub": "#141B2F",
    "--rule": "#2A3450",
    "--rule-2": "#3B4663",
    "--faint": "#5C6782",
    "--ink-3": "#8C95AB",
    "--ink-2": "#B9BDC7",
    "--ink": "#EFECE3",
    // A warm lamp tint for captions and the word "out", never a state.
    "--lamp": "#E3B985",
    "--constellation": "#6F7A95",
    "--line": "#3B4663",
    "--font-serif": '"Newsreader", "Noto Music", serif',
    "--font-text": '"IBM Plex Mono", "Noto Music", monospace',
    "--font-display": '"Newsreader", "Noto Music", serif',
  },
  modules: {
    circle: AtlasCircle,
    readout: AtlasReadout,
    controls: AtlasControls,
    menu: AtlasMenu,
    alterations: AtlasPads,
    ribbon: KeysRibbon,
    practice: Stub,
  },
  slots: {
    practice: [24, 8, 216, 0],
    controls: [24, 14, 216, 180],
    alterations: [24, 202, 216, 226],
    readout: [262, 14, 258, 110],
    ribbon: [262, 128, 258, 300],
    circle: [534, 4, 440, 440],
    menu: [262, 14, 258, 420],
  },
};

/** The star atlas is the app's look. */
export const skins = [atlas];
