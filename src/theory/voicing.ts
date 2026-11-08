/**
 * The voicing engine. It lists the ways a chord can sit across the voices, then takes the
 * one that moves least from the last chord. So it both makes progressions smooth and produces the
 * exact movement the ribbon shows.
 */
export type Spread = "close" | "open" | "wide";
export const SPREADS: Spread[] = ["close", "open", "wide"];

export const UPPER_VOICES = 4;
export const VOICE_COUNT = UPPER_VOICES + 1; // the bass is the last voice

export interface Voiced {
  upper: number[];
  bass: number;
}
export const voicesOf = (v: Voiced) => [...v.upper, v.bass];

/**
 * Where the upper voices may sit. `center` and `drift` limit their average, which is what re-centers
 * a progression that keeps walking one way. The bass stays below all of these, so nothing can cross.
 */
export const REGISTER: Record<Spread, { lo: number; hi: number; center: number; drift: number }> = {
  close: { lo: 55, hi: 79, center: 66, drift: 8 },
  open: { lo: 53, hi: 81, center: 63, drift: 8 },
  wide: { lo: 53, hi: 88, center: 69, drift: 9 },
};
export const BASS_RANGE = { lo: 36, hi: 52, center: 45 }; // C2 to E3

const pcOf = (midi: number) => ((midi % 12) + 12) % 12;

/**
 * Chord tones in the order they're worth keeping, so the last ones go first when notes outnumber
 * voices. The 5th adds least, which is why it's first to go.
 */
export function keepOrder(tones: { root: number; third?: number; fifth?: number; seventh?: number; extensions?: number[] }): number[] {
  const { root, third, fifth, seventh, extensions = [] } = tones;
  return [root, third, seventh, ...extensions, fifth].filter((t): t is number => t !== undefined);
}

function pitchesOf(kept: number[], lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (kept.includes(pcOf(m))) out.push(m);
  return out;
}

/** Every chord tone next to the next, with none skipped. N consecutive tones, from any starting note. */
function closeRuns(kept: number[], n: number, lo: number, hi: number): number[][] {
  const p = pitchesOf(kept, lo, hi);
  const out: number[][] = [];
  for (let i = 0; i + n <= p.length; i++) out.push(p.slice(i, i + n));
  return out;
}

interface Spacing {
  minSpan: number;
  maxSpan: number;
  minGap: number;
  maxGap: number;
  minLowGap: number;
}

/** Any spacing of the chord's notes that meets the limits, each chord tone present at least once. */
function spaced(kept: number[], n: number, lo: number, hi: number, limits: Spacing): number[][] {
  const p = pitchesOf(kept, lo, hi);
  const out: number[][] = [];
  const pick = (from: number, chosen: number[]) => {
    if (chosen.length === n) {
      const span = chosen[n - 1] - chosen[0];
      if (span < limits.minSpan || span > limits.maxSpan) return;
      if (kept.every((pc) => chosen.some((m) => pcOf(m) === pc))) out.push([...chosen]);
      return;
    }
    for (let i = from; i < p.length; i++) {
      const prev = chosen[chosen.length - 1];
      if (prev !== undefined) {
        const gap = p[i] - prev;
        if (gap < (chosen.length === 1 ? limits.minLowGap : limits.minGap)) continue;
        if (gap > limits.maxGap) break;
      }
      chosen.push(p[i]);
      pick(i + 1, chosen);
      chosen.pop();
    }
  };
  pick(0, []);
  return out;
}

/**
 * Drop-2: a close voicing with its second voice from the top moved down an octave. Past 4 voices a
 * triad doubles every note, so dropping one lands on a note already there. Those get the same kind
 * of spacing, chosen by limits instead.
 */
function open(kept: number[], n: number, lo: number, hi: number): number[][] {
  if (n > 4) return spaced(kept, n, lo, hi, { minSpan: 13, maxSpan: 24, minGap: 2, maxGap: 9, minLowGap: 5 });
  // A run reaching an octave above the range still drops back into it, unless its top is too high.
  return closeRuns(kept, n, lo, hi + 12)
    .map((run) => [run[n - 2] - 12, ...run.slice(0, n - 2), run[n - 1]])
    .filter((v) => v[0] >= lo && v[n - 1] <= hi);
}

/** Two octaves or more from bottom to top, spaced wider at the bottom where close notes turn muddy. */
const wide = (kept: number[], n: number, lo: number, hi: number) =>
  spaced(kept, n, lo, hi, { minSpan: 24, maxSpan: 99, minGap: 3, maxGap: 19, minLowGap: 5 });

const SHAPES: Record<Spread, (kept: number[], n: number, lo: number, hi: number) => number[][]> = {
  close: closeRuns,
  open,
  wide,
};

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

const cache = new Map<string, number[][]>();

/** Every valid placement of a chord. Few enough, and cached, so a press stays well under budget. */
export function candidates(tones: number[], spread: Spread, n = UPPER_VOICES): number[][] {
  const kept = tones.slice(0, n);
  const id = `${spread}:${n}:${kept.join()}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const { lo, hi, center, drift } = REGISTER[spread];
  const all = SHAPES[spread](kept, n, lo, hi).filter((v) => Math.abs(mean(v) - center) <= drift);
  cache.set(id, all);
  return all;
}

/** A top voice leaping past a 5th is the one movement listeners track as melody, so it costs extra. */
const TOP_LEAP = { free: 7, per: 2 };

export const movement = (from: number[], to: number[]) => to.reduce((sum, m, i) => sum + Math.abs(m - from[i]), 0);

export function score(from: number[], to: number[]): number {
  const leap = Math.abs(to[to.length - 1] - from[from.length - 1]);
  return movement(from, to) + Math.max(0, leap - TOP_LEAP.free) * TOP_LEAP.per;
}

function chooseUpper(tones: number[], spread: Spread, n: number, prev: number[] | null): number[] {
  const { center } = REGISTER[spread];
  const list = candidates(tones, spread, n);
  const from = prev && prev.length === n ? prev : null;
  let best = list[0];
  let bestRank: number[] | null = null;
  for (const v of list) {
    // Lowest wins, in this order: how far the voices move, keeping the top note still, staying central.
    const rank = [
      from ? score(from, v) : 0,
      from && v[n - 1] !== from[n - 1] ? 1 : 0,
      Math.abs(mean(v) - center),
    ];
    if (!bestRank || isLess(rank, bestRank)) {
      best = v;
      bestRank = rank;
    }
  }
  return best;
}

const isLess = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
};

/** The root in its own low register, so root motion stays audible. Nearest to the last bass note. */
export function chooseBass(root: number, prev: number | null): number {
  const { lo, hi, center } = BASS_RANGE;
  let best = -1;
  for (let m = lo; m <= hi; m++) {
    if (pcOf(m) !== root) continue;
    if (best < 0) {
      best = m;
      continue;
    }
    const ref = prev ?? center;
    const d = Math.abs(m - ref) - Math.abs(best - ref);
    if (d < 0 || (d === 0 && Math.abs(m - center) < Math.abs(best - center))) best = m;
  }
  return best;
}

export interface VoicingRequest {
  root: number;
  /** Pitch classes, most worth keeping first. See `keepOrder`. */
  tones: number[];
}

export function voice(chord: VoicingRequest, prev: Voiced | null, spread: Spread = "close", n = UPPER_VOICES): Voiced {
  return {
    upper: chooseUpper(chord.tones, spread, n, prev?.upper ?? null),
    bass: chooseBass(chord.root, prev?.bass ?? null),
  };
}
