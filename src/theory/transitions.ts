/**
 * Likely next chords, switchable, counted from real music. Modern pop is Hooktheory's TheoryTab
 * annotations (15,213 songs); Classic pop is the McGill Billboard Project's 739 chart songs, 1958 to 1991;
 * Jazz is the iRb corpus's 1,185 standards. `tools/corpus/transitions.py` does the counting and writes `corpus.json`; only the
 * resulting proportions live here. A row is kept when at least 20 transitions leave that chord, and a target when it
 * follows at least 2% of the time, so every number shown was measured.
 *
 * Adding a genre means counting another corpus into `corpus.json`.
 */
import { chordOf, circleChords, cellOf, readNumeral, sameChord, type Alts, type ChordRef } from "./keyLens";
import { mod, type Key } from "./spell";
import corpus from "./corpus.json";

export interface Weight {
  p: number;
  source: "measured" | "estimate";
}
export type Table = Record<string, Record<string, Weight>>;
export interface TransitionPreset {
  id: string;
  name: string;
  /** What a button can fit. */
  short: string;
  /** Where the numbers come from, for saying so on screen. */
  source: string;
  songs: number;
  major: Table;
  minor: Table;
}

type Counted = { rows: Record<string, { to: Record<string, number> }> };
const table = ({ rows }: Counted): Table =>
  Object.fromEntries(
    Object.entries(rows).map(([from, { to }]) => [from, Object.fromEntries(Object.entries(to).map(([t, p]) => [t, { p, source: "measured" as const }]))]),
  );

// "pop" stays the id of today's pop, so a phone that saved "Pop" lands on it; Billboard is the classic set.
export const PRESETS: TransitionPreset[] = [
  { id: "pop", name: "Modern pop", short: "Modern", source: corpus.modern.source, songs: corpus.modern.songs, major: table(corpus.modern.major), minor: table(corpus.modern.minor) },
  { id: "classic", name: "Classic pop", short: "Classic", source: corpus.pop.source, songs: corpus.pop.songs, major: table(corpus.pop.major), minor: table(corpus.pop.minor) },
  { id: "jazz", name: "Jazz", short: "Jazz", source: corpus.jazz.source, songs: corpus.jazz.songs, major: table(corpus.jazz.major), minor: table(corpus.jazz.minor) },
];

const e = (p: number): Weight => ({ p, source: "estimate" });

/** A chord outside the key has no row in a table, so these say how sure its one arrow is. Estimates. */
const LEADS_TO: Weight = e(0.6); // a secondary dominant to its target
const COUNTERCLOCKWISE: Weight = e(0.4); // anything else, one column on

export interface NextChord extends Weight {
  ref: ChordRef;
  /** The root falls a fifth: the strong direction, counterclockwise by root. */
  solid: boolean;
}

const fallsAFifth = (from: number, to: number) => mod(from + 5, 12) === to;

export function nextChords(pressed: ChordRef, key: Key, presetId: string, alts?: Alts): NextChord[] {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return [];
  const altered = alts ? chordOf(pressed, key, alts) : null;
  // A cell made the other quality is that other chord, so it goes where that chord would.
  const ref =
    altered && !altered.raised && alts?.quality ? cellOf(altered.root, alts.quality === "major" ? "maj" : "min") : pressed;
  const from = chordOf(ref, key);
  const all = circleChords(key);
  const cells = all.filter((c) => c.inKey);
  // Any chord with a row of its own goes by it, in the key or not (the corpora count ♭VII, II and the rest).
  const row = preset[key.mode][altered?.raised ? "V" : from.numeral];
  const make = (target: ChordRef, w: Weight): NextChord => ({
    ...w,
    ref: target,
    solid: fallsAFifth(from.root, chordOf(target, key).root),
  });

  if (row) {
    return Object.entries(row)
      .flatMap(([numeral, w]) => {
        // Every chord on the circle can be a target; a numeral with no cell (most diminished chords) can't.
        // Matched by what it is, root and quality, so a key's respelling can't lose it.
        const meant = readNumeral(numeral, key);
        const cell = meant && all.find((c) => c.ref.ring === meant.ring && c.root === meant.pc && !sameChord(c.ref, ref));
        return cell ? [make(cell.ref, w)] : [];
      })
      .sort((a, b) => b.p - a.p);
  }
  // Outside the key. A major chord that falls a fifth onto a chord in the key leads there.
  const target = ref.ring === "maj" ? cells.find((c) => c.root === mod(from.root + 5, 12)) : undefined;
  if (target && !sameChord(target.ref, ref)) return [make(target.ref, LEADS_TO)];
  const ring = ref.ring === "dim" ? "maj" : ref.ring;
  return [make({ ring, col: mod(ref.col - 1, 12) }, COUNTERCLOCKWISE)];
}
