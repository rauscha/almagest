/**
 * Note names by position on the line of fifths, where C is 0, G is 1 and F is -1. Spelling then
 * comes from which position a note takes for the key: F♯ as V of B, never G♭.
 */
export type Mode = "major" | "minor";
export interface Key {
  /** Column on the circle of the key's signature: C major and A minor are both 0. */
  col: number;
  mode: Mode;
}

export const mod = (n: number, m: number) => ((n % m) + m) % m;

const LETTERS = "FCGDAEB";
const accidental = (n: number) =>
  n === 0 ? "" : n > 0 ? "♯".repeat(n % 2) + "𝄪".repeat(n >> 1) : "♭".repeat(-n);

export function noteAt(position: number): string {
  const i = position + 1;
  return LETTERS[mod(i, 7)] + accidental(Math.floor(i / 7));
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** A note's name with the octave it's written in, which goes by its letter: C♭4 is the B just under C4. */
export function withOctave(name: string, midi: number): string {
  const letter = LETTER_PC[name[0]];
  const sharps = [...name.slice(1)].reduce((sum, ch) => sum + (ch === "♯" ? 1 : ch === "𝄪" ? 2 : ch === "♭" ? -1 : 0), 0);
  return `${name}${Math.round((midi - letter - sharps) / 12) - 1}`;
}

/** The signature's place on the line of fifths. Column 6 is written G♭ rather than F♯. */
export function signature(key: Key): number {
  return key.col <= 5 ? key.col : key.col - 12;
}

/** The position of `col` that falls in [lo, hi], preferring the key's own seven notes. */
function place(col: number, sig: number, lo: number, hi: number, limit: number): number {
  for (let p = sig - 1; p <= sig + 5; p++) if (mod(p, 12) === col) return p;
  for (let p = lo; p <= hi; p++) {
    if (mod(p, 12) === col) return Math.abs(p) > limit ? p - Math.sign(p) * 12 : p;
  }
  return col;
}

/** Where a major chord's root falls on the line of fifths, for this key. */
export function majorRoot(col: number, key: Key): number {
  const s = signature(key);
  return place(col, s, s - 6, s + 5, 7);
}

/** Where a minor chord's root falls. It's three fifths above the column. */
export function minorRoot(col: number, key: Key): number {
  const s = signature(key);
  return place(mod(col + 3, 12), s, s - 3, s + 8, 8);
}

/**
 * Where a column's diminished chord's root falls: the seventh degree of that column's major scale. Only
 * the key's own is on the circle, but a chord already played stays itself after the key moves.
 */
export function diminishedRoot(col: number, key: Key): number {
  const s = signature(key);
  return place(mod(col + 5, 12), s, s - 1, s + 10, 8);
}

export const majorName = (col: number, key: Key) => noteAt(majorRoot(col, key));
export const minorName = (col: number, key: Key) => `${noteAt(minorRoot(col, key))}m`;
export const diminishedName = (col: number, key: Key) => `${noteAt(diminishedRoot(col, key))}°`;

const DEGREE: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };
const LETTER_POS: Record<string, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

/** The scale degree a numeral names (1 to 7), ignoring its accidental, case and quality marks. */
export function degreeOf(numeral: string): number {
  const roman = numeral.replace(/[^IVXivx]/g, "").toLowerCase().match(/^(vii|vi|v|iv|iii|ii|i)/)?.[1];
  if (!roman) throw new Error(`No degree in ${numeral}`);
  return DEGREE[roman];
}

/**
 * Where a chord's root falls when it's spelled by its numeral: the letter is that degree counted up from
 * the tonic's letter, and the accidental is whatever reaches the pitch. So in E minor the chord a major 7th
 * above E is D♯ (♯VII), never E♭; the name follows the numeral.
 */
export function rootByDegree(key: Key, degree: number, rootPc: number): number {
  const tonic = signature(key) + (key.mode === "minor" ? 3 : 0);
  const letters = "CDEFGAB";
  const tonicLetter = noteAt(tonic)[0];
  const letter = letters[mod(letters.indexOf(tonicLetter) + degree - 1, 7)];
  const natural = LETTER_POS[letter];
  // Each sharp moves seven places along the line of fifths and raises the pitch a semitone.
  let k = mod(rootPc - mod(natural * 7, 12), 12);
  if (k > 6) k -= 12;
  return natural + 7 * k;
}
