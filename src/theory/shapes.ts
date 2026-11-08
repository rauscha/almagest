/**
 * Named shapes: progressions the trail can be recognized as.
 * A shape is matched by root motion and chord quality, measured from its own tonic, so it's found in any
 * key; when its tonic isn't the key's home, the match says where it is ("in D minor").
 */
import type { Ring, Top } from "./keyLens";
import { mod } from "./spell";
import type { Key } from "./spell";

interface Step {
  /** Semitones above the shape's tonic. */
  up: number;
  rings: Ring[];
  /**
   * The pad the step is usually played with, when shapes are drawn with their 7ths and add9s:
   * ii7–V7–Imaj7, as a jazz chart writes it. Matching ignores it, as it ignores a pad's 7th.
   */
  color?: Top;
}
export interface ShapeDef {
  id: string;
  /** What it's called, in words. */
  name: string;
  /** A short label for under the trail. */
  short: string;
  /** What the Menu calls it. */
  label: string;
  steps: Step[];
  /** Which step is the tonic: the last for a cadence, the first for a loop. */
  tonic: number;
}

const st = (up: number, ...rings: Ring[]): Step => ({ up, rings });
const withPad = (step: Step, color: Top): Step => ({ ...step, color });

/** The library: longest first, so a longer shape wins over one inside it. */
export const SHAPES: ShapeDef[] = [
  { id: "circle", label: "Circle", name: "circle progression", short: "CIRCLE", tonic: 3,
    steps: [withPad(st(9, "min"), "7"), withPad(st(2, "min"), "7"), withPad(st(7, "maj"), "7"), withPad(st(0, "maj"), "maj7")] },
  { id: "axis", label: "Axis", name: "axis progression", short: "AXIS", tonic: 0,
    steps: [withPad(st(0, "maj"), "add9"), st(7, "maj"), withPad(st(9, "min"), "7"), withPad(st(5, "maj"), "maj7")] },
  { id: "andalusian", label: "Andalusian", name: "Andalusian cadence", short: "ANDALUSIAN", tonic: 0,
    steps: [st(0, "min"), st(10, "maj"), st(8, "maj"), withPad(st(7, "maj"), "7")] },
  { id: "two-five-one", label: "ii–V–I", name: "two-five-one", short: "TWO-FIVE-ONE", tonic: 2,
    steps: [withPad(st(2, "min", "dim"), "7"), withPad(st(7, "maj"), "7"), withPad(st(0, "maj", "min"), "maj7")] },
];

/** A chord as a shape sees it: its root's pitch class and its quality. */
export interface ShapeChord {
  root: number;
  ring: Ring;
  /** The root's name for the key, for saying where a shape is (D, F♯…). */
  rootName: string;
}

export interface FoundShape {
  id: string;
  name: string;
  short: string;
  /** The shape's own numerals, counted from its tonic: ii–V–I, or ii°–V–i aimed at a minor chord. */
  numerals: string;
  /** Where it is when its tonic isn't the key's home ("D minor"); null at home. */
  where: string | null;
  /** First and last index into the chords given, with repeats of one chord counted as one. */
  from: number;
  to: number;
}

const ROMAN = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];

function numeral(up: number, ring: Ring): string {
  const r = ROMAN[mod(up, 12)];
  if (ring === "maj") return r;
  return ring === "dim" ? `${r.toLowerCase()}°` : r.toLowerCase();
}

/**
 * Every named shape in the trail, oldest first. Read from the end back: at each point the longest shape
 * ending there is taken, and the search goes on from its first chord, so two shapes may share a chord
 * (a circle progression ending on C, an axis starting from it) but never overlap further, and a ii–V–I
 * inside a circle progression isn't named twice.
 */
export function findShapes(chords: ShapeChord[], key: Key): FoundShape[] {
  const groups = grouped(chords);

  const homePc = mod(key.col * 7 + (key.mode === "major" ? 0 : 9), 12);
  const homeRing: Ring = key.mode === "major" ? "maj" : "min";
  const found: FoundShape[] = [];
  let end = groups.length - 1;
  while (end >= 0) {
    const hit = match(groups, end);
    if (!hit) {
      end--;
      continue;
    }
    const { def, start } = hit;
    const tonic = groups[start + def.tonic].chord;
    const home = tonic.root === homePc && tonic.ring === homeRing;
    found.unshift({
      id: def.id,
      name: def.name,
      short: def.short,
      numerals: def.steps.map((s, k) => numeral(s.up, groups[start + k].chord.ring)).join("–"),
      where: home ? null : `${tonic.rootName} ${tonic.ring === "min" ? "minor" : "major"}`,
      from: groups[start].from,
      to: groups[end].to,
    });
    end = start; // the next shape may end on this one's first chord, no later
  }
  return found;
}

/** Repeats of one chord (C, then C7 from a pad) are one step of a shape. */
function grouped(chords: ShapeChord[]) {
  const groups: { chord: ShapeChord; from: number; to: number }[] = [];
  chords.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (last && last.chord.root === c.root && last.chord.ring === c.ring) last.to = i;
    else groups.push({ chord: c, from: i, to: i });
  });
  return groups;
}

/** A shape set in a key: each step's root and the ring it's drawn on. */
export interface PlacedShape {
  def: ShapeDef;
  steps: { root: number; ring: "maj" | "min"; rings: Ring[]; numeral: string; color: Top | null }[];
  /** The tonic's root and quality, for saying which key it's drawn in. */
  tonic: { root: number; ring: "maj" | "min" };
}

/**
 * A shape from the library, set where it belongs in a key, so a pattern can be loaded and seen drawn in
 * any key. A shape aimed at a major chord lands on the key's major home (in a minor key, its relative
 * major); one aimed at a minor chord, on its minor home. So turning the key turns the shape: same shape,
 * rotated.
 */
export function placeShape(id: string, key: Key): PlacedShape | null {
  const def = SHAPES.find((d) => d.id === id);
  if (!def) return null;
  const home = mod(key.col * 7 + (key.mode === "major" ? 0 : 9), 12);
  const ring = def.steps[def.tonic].rings[0] === "min" ? "min" : "maj";
  const root =
    ring === "maj" ? (key.mode === "major" ? home : mod(home + 3, 12)) : key.mode === "minor" ? home : mod(home + 9, 12);
  return {
    def,
    tonic: { root, ring },
    steps: def.steps.map((s) => ({
      root: mod(root + s.up, 12),
      ring: s.rings[0] === "min" ? "min" : "maj",
      rings: s.rings,
      numeral: numeral(s.up, s.rings[0]),
      color: s.color ?? null,
    })),
  };
}

/**
 * How many of a placed shape's steps the trail has just played, in order, ending now: 2 after vi and ii
 * of vi–ii–V–I. A finished shape counts as none played, so a loop (the axis) starts over.
 */
export function stepsPlayed(shape: PlacedShape, chords: ShapeChord[]): number {
  const groups = grouped(chords);
  const n = shape.steps.length;
  for (let k = Math.min(n, groups.length); k > 0; k--) {
    const tail = groups.slice(groups.length - k);
    if (tail.every((g, i) => g.chord.root === shape.steps[i].root && shape.steps[i].rings.includes(g.chord.ring))) return k === n ? 0 : k;
  }
  return 0;
}

function match(groups: { chord: ShapeChord }[], end: number): { def: ShapeDef; start: number } | null {
  for (const def of SHAPES) {
    const start = end - def.steps.length + 1;
    if (start < 0) continue;
    const t = groups[start + def.tonic].chord.root;
    const fits = def.steps.every((s, k) => {
      const c = groups[start + k].chord;
      return mod(c.root - t, 12) === s.up && s.rings.includes(c.ring);
    });
    if (fits) return { def, start };
  }
  return null;
}
