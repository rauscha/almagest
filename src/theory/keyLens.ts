/** Everything a key says about a chord on the circle: its name, numeral and function. */
import { type Key, mod, majorRoot, minorRoot, diminishedRoot, noteAt, signature, degreeOf, rootByDegree } from "./spell";
import { keepOrder } from "./voicing";

export type Ring = "maj" | "min" | "dim";
export type Fn = "tonic" | "subdominant" | "dominant" | "both";
export interface ChordRef {
  ring: Ring;
  col: number;
}

export type Top = "7" | "maj7" | "9" | "add9";
export type Sus = "sus2" | "sus4";
export type Quality = "major" | "minor";
export type Alteration = Top | Sus | Quality;
/** What's been done to a chord beyond its cell on the circle. */
export interface Alts {
  top: Top | null;
  sus: Sus | null;
  /**
   * Major or minor whatever the cell: C made minor is the borrowed iv in G, and Bm made major is III, as
   * in Creep. On v in a minor key, major is the raised V, and its third is the leading tone.
   */
  quality: Quality | null;
}
export const PLAIN: Alts = { top: null, sus: null, quality: null };
export const ALTERATIONS: Alteration[] = ["7", "maj7", "9", "add9", "sus2", "sus4", "major", "minor"];

const isSus = (a: Alteration): a is Sus => a === "sus2" || a === "sus4";
export const isQuality = (a: Alteration): a is Quality => a === "major" || a === "minor";
export const hasAlteration = (alts: Alts, a: Alteration) =>
  isQuality(a) ? alts.quality === a : isSus(a) ? alts.sus === a : alts.top === a;

/**
 * Switches one on or off. 7, maj7, 9 and add9 replace each other, and so do sus2 and sus4, but one of
 * each can stack, as in G7sus4. A sus2's added note is already the 9th, so those two can't.
 */
export function toggleAlteration(alts: Alts, a: Alteration): Alts {
  if (isQuality(a)) return { ...alts, quality: alts.quality === a ? null : a };
  if (hasAlteration(alts, a)) return isSus(a) ? { ...alts, sus: null } : { ...alts, top: null };
  if (isSus(a)) return { ...alts, sus: a, top: a === "sus2" && (alts.top === "9" || alts.top === "add9") ? null : alts.top };
  return { ...alts, top: a, sus: alts.sus === "sus2" && (a === "9" || a === "add9") ? null : alts.sus };
}

/**
 * A diminished chord has no 3rd to suspend that would leave it sounding like itself, and a cell can't
 * be made the quality it already is.
 */
export const canAlter = (ring: Ring, a: Alteration) =>
  !(ring === "dim" && isSus(a)) && !(ring === "maj" && a === "major") && !(ring === "min" && a === "minor");

export interface Chord {
  ref: ChordRef;
  alts: Alts;
  name: string;
  numeral: string;
  /** Pitch classes, root first. */
  pcs: number[];
  /** Each of those notes, spelled for this key: F♯ as V of B, never G♭. */
  notes: string[];
  /** The same pitch classes, most worth keeping first, for when there are more notes than voices. */
  keep: number[];
  root: number;
  inKey: boolean;
  fn: Fn | null;
  /** v in a minor key made major. */
  raised: boolean;
  /** The note a raised V raises. It's marked wherever it's shown. */
  leadingTone: number | null;
  /** The pitch classes a pad added, a 7th and a 9th, so the voices can say which note is which. */
  seventh: number | null;
  ninth: number | null;
}

/**
 * Tones as steps along the line of fifths from the root, which fixes their spelling as well as their
 * pitch: seven semitones per step, so +4 is a major 3rd and -3 is a minor 3rd.
 */
const THIRD: Record<Ring, number> = { maj: 4, min: -3, dim: -3 };
const FIFTH: Record<Ring, number> = { maj: 1, min: 1, dim: -6 };
const SUS_STEP: Record<Sus, number> = { sus2: 2, sus4: -1 };
const SEVENTH: Partial<Record<Top, number>> = { "7": -2, maj7: 5, "9": -2 };
const NINTH = 2;

// [ring:offset from the key's column] -> numeral and function
const WEDGE: Record<Key["mode"], Record<string, [string, Fn]>> = {
  major: {
    "maj:-1": ["IV", "subdominant"],
    "maj:0": ["I", "tonic"],
    "maj:1": ["V", "dominant"],
    "min:-1": ["ii", "subdominant"],
    "min:0": ["vi", "tonic"],
    "min:1": ["iii", "both"], // taught both ways
    "dim:0": ["vii°", "dominant"],
  },
  minor: {
    "maj:-1": ["VI", "subdominant"],
    "maj:0": ["III", "tonic"],
    "maj:1": ["VII", "dominant"],
    "min:-1": ["iv", "subdominant"],
    "min:0": ["i", "tonic"],
    "min:1": ["v", "dominant"], // natural v on the wedge
    "dim:0": ["ii°", "subdominant"],
  },
};

const CHROMATIC: Record<Key["mode"], string[]> = {
  major: ["I", "♭II", "II", "♭III", "III", "IV", "♭V", "V", "♭VI", "VI", "♭VII", "VII"],
  minor: ["I", "♭II", "II", "III", "♯III", "IV", "♭V", "V", "VI", "♯VI", "VII", "♯VII"],
};
/**
 * In a major key a minor or diminished chord on an altered root is conventionally sharp where a major
 * chord there is flat: F♯m is ♯iv in C, but G♭ is ♭V. Since the name follows the numeral, this keeps the
 * circle's outside minor chords spelled as they always were (F♯m, C♯m, G♯m, E♭m, B♭m in C).
 */
const CHROMATIC_MINOR_QUALITY: Record<Key["mode"], string[]> = {
  major: ["I", "♯I", "II", "♭III", "III", "IV", "♯IV", "V", "♯V", "VI", "♭VII", "VII"],
  minor: CHROMATIC.minor,
};

const offset = (col: number, home: number) => {
  const d = mod(col - home, 12);
  return d > 6 ? d - 12 : d;
};

/**
 * What a numeral means in a key, whatever its spelling: the root's pitch class and the triad's quality.
 * The corpora count by numeral; this finds the cell even where a key's spelling had to renumber it.
 */
export function readNumeral(numeral: string, key: Key): { pc: number; ring: Ring } | null {
  const ring: Ring = numeral.endsWith("°") ? "dim" : numeral.replace(/[^IViv]/g, "") === numeral.replace(/[^IViv]/g, "").toUpperCase() ? "maj" : "min";
  const bare = numeral.replace("°", "");
  const table = ring === "maj" ? CHROMATIC[key.mode] : CHROMATIC_MINOR_QUALITY[key.mode];
  const at = table.findIndex((n) => (ring === "maj" ? n : n.toLowerCase()) === bare);
  if (at >= 0) return { pc: mod(tonicPc(key) + at, 12), ring };
  // A natural degree that this mode's table spells differently (the raised V in minor is "V" in both).
  const plain = CHROMATIC.major.findIndex((n) => n.toLowerCase() === bare.toLowerCase());
  return plain >= 0 ? { pc: mod(tonicPc(key) + plain, 12), ring } : null;
}

export const tonicPc = (key: Key) => mod(key.col * 7 + (key.mode === "major" ? 0 : 9), 12);

function rootOf({ ring, col }: ChordRef): number {
  const major = col * 7;
  return mod(ring === "maj" ? major : ring === "min" ? major + 9 : major + 11, 12);
}

const MINOR_TOP: Record<Top, string> = { "7": "7", maj7: "(maj7)", "9": "9", add9: "(add9)" };
const DIM_TOP: Record<Top, string> = { "7": "ø7", maj7: "°(maj7)", "9": "ø9", add9: "°(add9)" };

/** What follows the root in a chord's name. A sus chord has no 3rd, so it's named by root alone. */
function suffix(quality: Ring, { top, sus }: Alts): string {
  if (sus) return top === "add9" ? `${sus}add9` : `${top ?? ""}${sus}`;
  if (quality === "maj") return top ?? "";
  if (quality === "min") return top ? `m${MINOR_TOP[top]}` : "m";
  return top ? DIM_TOP[top] : "°";
}

/** The same in a numeral, where the numeral's case already says major or minor. */
function numeralFor(base: string, quality: Ring, { top, sus }: Alts): string {
  if (sus) return base + (top === "add9" ? `${sus}add9` : `${top ?? ""}${sus}`);
  if (quality === "dim" && top) return base.replace("°", "") + DIM_TOP[top].replace("(", "").replace(")", "");
  return base + (top ?? "");
}

const accidentals = (name: string) => [...name.slice(1)].reduce((n, ch) => n + (ch === "𝄪" ? 2 : ch === "♯" || ch === "♭" ? 1 : 0), 0);
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
/** The scale each mode's numerals are measured from: major for major keys, natural minor for minor keys. */
const SCALE: Record<Key["mode"], number[]> = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

/** A numeral read off a spelling: its letter gives the degree, and the pitch against the mode's scale the accidental. */
function numeralSpelled(position: number, root: number, key: Key, quality: Ring, diminished: boolean): string {
  const letters = "CDEFGAB";
  const tonic = noteAt(signature(key) + (key.mode === "minor" ? 3 : 0))[0];
  const degree = mod(letters.indexOf(noteAt(position)[0]) - letters.indexOf(tonic), 7);
  const shift = mod(root - tonicPc(key) - SCALE[key.mode][degree] + 6, 12) - 6;
  const roman = (shift < 0 ? "♭".repeat(-shift) : "♯".repeat(shift)) + ROMAN[degree];
  if (diminished) return `${roman.toLowerCase()}°`;
  return quality === "maj" ? roman : roman.toLowerCase();
}

export function chordOf(ref: ChordRef, key: Key, alts: Alts = PLAIN): Chord {
  const root = rootOf(ref);
  const quality: Ring = alts.quality === "major" ? "maj" : alts.quality === "minor" ? "min" : ref.ring;
  const raised = alts.quality === "major" && canRaise(ref, key);
  // A cell made the other quality is a different chord, and only the raised V keeps its function.
  const changed = quality !== ref.ring;
  const cell = WEDGE[key.mode][`${ref.ring}:${offset(ref.col, key.col)}`];
  const wedge = changed && !raised ? undefined : cell;
  const chromatic = (quality === "maj" ? CHROMATIC : CHROMATIC_MINOR_QUALITY)[key.mode][mod(root - tonicPc(key), 12)];
  let base = changed
    ? quality === "maj" ? chromatic : chromatic.toLowerCase()
    : wedge
      ? wedge[0]
      : ref.ring === "maj" ? chromatic : ref.ring === "min" ? chromatic.toLowerCase() : `${chromatic.toLowerCase()}°`;
  // A chord the key doesn't own is spelled by its numeral, so the two always agree.
  const byNumeral = changed || !wedge;
  let rootAt = byNumeral
    ? rootByDegree(key, degreeOf(base), root)
    : ref.ring === "maj" ? majorRoot(ref.col, key) : ref.ring === "min" ? minorRoot(ref.col, key) : diminishedRoot(ref.col, key);
  // Outside chords never take a double accidental. When the numeral's spelling would need one, take
  // the plain enharmonic and number it from that spelling instead, so name and numeral still agree.
  if (byNumeral && accidentals(noteAt(rootAt)) > 1) {
    rootAt = [rootAt - 12, rootAt + 12].find((p) => accidentals(noteAt(p)) <= 1) ?? rootAt;
    base = numeralSpelled(rootAt, root, key, quality, ref.ring === "dim" && !changed);
  }

  const third = alts.sus ? SUS_STEP[alts.sus] : THIRD[quality];
  const seventh = alts.top ? SEVENTH[alts.top] : undefined;
  const ninth = alts.top === "9" || alts.top === "add9" ? NINTH : undefined;
  const steps = [0, third, FIFTH[quality], seventh, ninth].filter((n): n is number => n !== undefined);
  const pcAt = (step: number) => mod(root + step * 7, 12);

  return {
    ref,
    alts,
    name: noteAt(rootAt) + suffix(quality, alts),
    numeral: numeralFor(base, quality, alts),
    pcs: steps.map(pcAt),
    notes: steps.map((step) => noteAt(rootAt + step)),
    keep: keepOrder({
      root,
      third: pcAt(third),
      fifth: pcAt(FIFTH[quality]),
      seventh: seventh === undefined ? undefined : pcAt(seventh),
      extensions: ninth === undefined ? [] : [pcAt(ninth)],
    }),
    root,
    inKey: !!wedge && !raised,
    fn: wedge ? wedge[1] : null,
    raised,
    leadingTone: raised ? pcAt(third) : null,
    seventh: seventh === undefined ? null : pcAt(seventh),
    ninth: ninth === undefined ? null : pcAt(ninth),
  };
}

/** Whether every note of a chord is in the key's signature. */
export function fitsKey(chord: Chord, key: Key): boolean {
  const s = signature(key);
  const scale = new Set([...Array(7).keys()].map((i) => mod((s - 1 + i) * 7, 12)));
  return chord.pcs.every((pc) => scale.has(pc));
}

/** The cell that can be raised: v in a minor key. */
export function canRaise(ref: ChordRef, key: Key): boolean {
  return key.mode === "minor" && ref.ring === "min" && offset(ref.col, key.col) === 1;
}

/** The circle's own cell for a root and quality, which is where a chord made the other quality really lives. */
export function cellOf(root: number, ring: "maj" | "min"): ChordRef {
  return { ring, col: ring === "maj" ? mod(root * 7, 12) : mod((root - 9) * 7, 12) };
}

/** A dominant 7th and nothing else, whatever's latched: how a secondary dominant is played. */
export const DOMINANT_7: Alts = { top: "7", sus: null, quality: null };

/**
 * The chord that leads to one with this root: the major chord a fifth above it, its secondary dominant
 * (G to C, E to Am, A to Dm). Played as a 7th, with `DOMINANT_7`.
 */
export const secondaryDominant = (root: number): ChordRef => cellOf(mod(root + 7, 12), "maj");

/** Every chord the circle offers in a key: 12 major, 12 minor, and only the key's own diminished. */
export function circleChords(key: Key): Chord[] {
  const out: Chord[] = [];
  for (const ring of ["maj", "min"] as const) {
    for (let col = 0; col < 12; col++) out.push(chordOf({ ring, col }, key));
  }
  out.push(chordOf({ ring: "dim", col: key.col }, key));
  return out;
}

export const sameChord = (a: ChordRef | null, b: ChordRef | null) =>
  !!a && !!b && a.ring === b.ring && a.col === b.col;

export const FUNCTION_WORD: Record<Fn, string> = {
  tonic: "Tonic",
  subdominant: "Subdominant",
  dominant: "Dominant",
  both: "Tonic or dominant",
};
