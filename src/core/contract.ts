/**
 * The contract between modules and everything else. It's the only app file a module may
 * import. A module takes a `view` of its own slot and a `send`, so any one can be thrown out and
 * rebuilt without the others noticing. `src/modules/modules.test.ts` enforces this.
 */
import type { ReadableAtom } from "nanostores";

export type Ring = "maj" | "min" | "dim";
export type Mode = "major" | "minor";
export type Spread = "close" | "open" | "wide";
export type SpaceLevel = "off" | "room" | "hall";
export type Fn = "tonic" | "subdominant" | "dominant" | "both";
export type Alteration = "7" | "maj7" | "9" | "add9" | "sus2" | "sus4" | "major" | "minor";
export interface ChordRef {
  ring: Ring;
  col: number;
}

export interface CircleChord {
  ref: ChordRef;
  name: string;
  numeral: string;
  inKey: boolean;
  /** Always present for in-key chords, so no skin has to rely on color for function. */
  fn: Fn | null;
  /** The cell's own name, unaltered, even while a held pad relabels it: a stable handle for the cell. */
  plain: string;
}

export interface RibbonColumn {
  name: string;
  numeral: string;
  upper: number[];
  bass: number;
}
/** One voice's change of note, from the chord before to the one now. */
export interface VoiceMove {
  from: number;
  to: number;
  bass: boolean;
}

/** One arrow out of the held chord. */
export interface NextArrow {
  ref: ChordRef;
  /** How likely, from 0 to 1. */
  p: number;
  /** Measured from real songs, or an estimate to tune by ear. */
  measured: boolean;
  /** Semitones the upper voices would move from where they are now, as the ribbon counts it. */
  cost: number;
}

export interface TendView {
  circle: {
    key: { name: string; mode: Mode; col: number };
    chords: CircleChord[];
    current: ChordRef | null;
    /** The current chord is still sounding (pressed, ringing on, or sustained), not just the last played. */
    sounding: boolean;
    held: boolean;
    /** The home head is being dragged. */
    moving: boolean;
    /** Every chord the counts say might come next, likeliest first, while a chord sounds. */
    next: NextArrow[];
    /**
     * After a long press, the chord that leads to the one pressed (its secondary dominant), named as a
     * slide onto it would play it, as a 7th. Null otherwise.
     */
    leads: { ref: ChordRef; name: string } | null;
    /** A pad is held, so every chord is named as a press would give it (G7, C7…). */
    relabeled: boolean;
    sustain: boolean;
    /** The chords played, oldest first, ending with the latest: the trail a look can draw as a constellation. */
    trail: ChordRef[];
    /** What's sounding as columns on the circle, and the chord before, for looks that draw chords as shapes. */
    shape: { now: number[]; before: number[]; kept: number[] } | null;
    /**
     * A progression from the library, drawn where it falls in this key: each step's chord and the
     * shape's own numeral, how many steps the trail has just played in order (`played`), and which key
     * it's drawn in. Null when none is loaded.
     */
    loaded: {
      numerals: string;
      name: string;
      where: string;
      /**
       * Each step's chord and numeral, with the pad it's usually played with when shapes are drawn with
       * their 7ths: `top` is what that adds to the numeral ("7", "maj7", "add9", or empty) and `name`
       * what pressing it gives when it's the next step (Cmaj7; C7 if a latched 7 wins).
       */
      steps: { ref: ChordRef; numeral: string; top: string; name: string }[];
      played: number;
    } | null;
  };
  readout: {
    name: string;
    numeral: string;
    relation: string;
    /** The sounding chord's function in the key, for looks that draw its mark beside the word. */
    fn: Fn | null;
    /** The key, for the readout at rest. */
    key: { name: string; mode: Mode };
    /** Semitones the upper voices moved to reach this chord. Null on the first. */
    moved: number | null;
    /** False when the sound isn't running while the app is in view, so the play screen can say so. */
    audioOk: boolean;
    /** The chord named is still sounding. When it's not, it's the last one played, kept to read. */
    sounding: boolean;
    /**
     * The named progression this chord just completed, if the trail ends in one: its own numerals
     * (ii–V–I), what it's called, and where it is when that isn't the key's home ("D minor").
     */
    shape: { numerals: string; name: string; where: string | null } | null;
  };
  /** What stays on the main screen. */
  controls: {
    spread: Spread;
    spreads: Spread[];
    /** Which arrows to show when a chord's held. Null is none. */
    preset: string | null;
    presets: { id: string; name: string; short: string }[];
    menuOpen: boolean;
    /** The likely next chords, the same as the ribbon's, for looks that list them here. */
    next: { name: string; numeral: string; p: number; measured: boolean; cost: number }[];
  };
  /** The sound settings, behind Menu: the synth controls sit behind a menu. */
  menu: {
    open: boolean;
    engines: { id: string; label: string }[];
    engine: string;
    models: string[];
    model: number;
    ringMs: number;
    ringChoices: number[];
    slide: boolean;
    slideMs: number;
    slideChoices: number[];
    /** The chorus and reverb around every voice. */
    space: SpaceLevel;
    spaces: SpaceLevel[];
    /** How the app is running, for checking on the phone. */
    about: string;
    /** Next chords' source, here as well as on the main screen. */
    preset: string | null;
    presets: { id: string; name: string; short: string }[];
    /** The library of progressions to draw on the circle, and the one loaded. */
    shapes: { id: string; label: string }[];
    shape: string | null;
    /** Shapes drawn with their usual 7ths and add9s, or plain. */
    colored: boolean;
  };
  alterations: {
    options: {
      id: Alteration;
      /** The chord this pad gives on what's sounding, named for the key. Empty in silence. */
      chord: string;
      on: boolean;
      /** Stays on for every chord until tapped off. */
      latched: boolean;
      /** A finger is on it now. */
      held: boolean;
      /** Whether that chord stays in the key. Null when nothing's sounding to judge by. */
      inKey: boolean | null;
      /** That chord's notes as columns on the circle, for looks that draw it. */
      columns: number[];
      available: boolean;
    }[];
    /** Sustain sits among the pads, under the same thumb. */
    /** Every chord takes its own 7th. */
    sevenInKey: boolean;
    /** The 7th the sounding chord takes in that mode, whether or not it's on. Empty when nothing's sounding. */
    sevenChord: string;
    /** The chord the pads act on, named for the key. Empty in silence. */
    chordName: string;
  };
  ribbon: {
    /** The pitches to draw, each [lowest, highest]. Fixed, so nothing jumps when the spread changes. */
    range: { upper: [number, number]; bass: [number, number] };
    /** Oldest first. The last is the chord now. */
    columns: RibbonColumn[];
    /**
     * What's sounding, named for the key. Empty in silence. `role` says which note a pad added, the 7th
     * or the 9th, so the voices can mark it.
     */
    sounding: { midi: number; name: string; role: "7" | "9" | null }[];
    /** The note a raised V raises. */
    leadingTone: { midi: number; name: string } | null;
    /** Only the voices that changed note. */
    moves: VoiceMove[];
    /** Where a held chord might go, strongest first, the numbers behind the circle's arrows. */
    next: { name: string; numeral: string; p: number; measured: boolean; cost: number }[];
    /** Semitones the upper voices moved to reach this chord. Null on the first. */
    cost: number | null;
    /**
     * The named progressions in the trail, oldest first, as first and last column. Two may share a
     * column. `now` marks the one ending on the chord now.
     */
    shapes: { from: number; to: number; short: string; now: boolean }[];
  };
  /** Not built yet. Its view grows when its slice arrives. */
  practice: Record<string, never>;
}
export type Slot = keyof TendView;

/** A circle reports raw touches. `core/gestures.ts` decides what they mean. */
export interface Touch {
  type: "touch";
  phase: "down" | "move" | "up" | "cancel";
  pointer: number;
  /**
   * The chord under the finger. On "move" it's only reported for a finger that went down on a chord, and
   * it stays on the last chord until the finger is well inside another, so a boundary can't flicker.
   */
  ref: ChordRef | null;
  /** On "down": the finger landed on the home head, which outranks any chord under it. */
  head?: boolean;
  /** Polar position from the circle's center, in the circle's own units. */
  r: number;
  theta: number;
  /** Which ring that distance falls in, whatever is under the finger. It's how a drag picks the mode. */
  ring?: Ring;
  time: number;
}

export type Intent =
  | Touch
  | { type: "padDown"; pad: Alteration; pointer: number }
  | { type: "padUp"; pointer: number }
  | { type: "menuToggled" }
  /** Forget the trail of chords played, keeping only what's sounding. */
  | { type: "trailCleared" }
  /** Draw a progression from the library on the circle, or put it away (null). */
  | { type: "shapeChosen"; shape: string | null }
  | { type: "shapeColored"; colored: boolean }
  | { type: "presetChanged"; preset: string | null }
  | { type: "sustainToggled" }
  | { type: "sevenInKeyToggled" }
  | { type: "spreadChanged"; spread: Spread }
  | { type: "slideToggled" }
  | { type: "slideTimeChanged"; ms: number }
  | { type: "ringChanged"; ms: number }
  | { type: "spaceChanged"; space: SpaceLevel }
  | { type: "engineChanged"; engine: string }
  | { type: "modelChanged"; model: number };

export type Send = (intent: Intent) => void;

export interface ModuleProps<S extends Slot> {
  view: ReadableAtom<TendView[S]>;
  send: Send;
}
