/**
 * Does a sound actually play the note it claims? Pure, so it can be tested on signals whose answer
 * is known. Two failures set what's measured: atonal sounds fail harmonicity, and sounds with such
 * strong overtones that they no longer play the notes claimed fail root share.
 */

export const midiToHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

export interface Spectrum {
  power: Float64Array;
  binHz: number;
}

/** Power by frequency, Hann windowed and zero-padded so close partials stay separate. */
export function spectrum(x: Float32Array | Float64Array, sr: number): Spectrum {
  let n = 1;
  while (n < x.length * 1.5) n <<= 1;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1)));
  fft(re, im);
  const power = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];
  return { power, binHz: sr / n };
}

/**
 * The whole sound, attack included, with each moment counting by how much energy it has. Skipping
 * the attack called a snare drum tonal, because all that was left was its faint ring. Windows start
 * before the sound does, so the taper can't hide the attack either.
 */
export function wholeSpectrum(x: Float32Array, sr: number): Spectrum {
  const win = Math.round(0.4 * sr);
  const hop = Math.round(win / 2);
  let sum: Spectrum | null = null;
  for (let start = -hop; start < x.length - hop; start += hop) {
    const frame = new Float64Array(win);
    for (let i = 0; i < win; i++) {
      const at = start + i;
      if (at >= 0 && at < x.length) frame[i] = x[at];
    }
    const s = spectrum(frame, sr);
    if (!sum) sum = s;
    else for (let i = 0; i < s.power.length; i++) sum.power[i] += s.power[i];
  }
  return sum ?? spectrum(new Float64Array(win), sr);
}

const rms = (x: Float32Array | Float64Array) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
};

/** Energy by pitch class, from 30 Hz to 8 kHz, each class spanning a semitone. Sums to 1. */
export function chroma({ power, binHz }: Spectrum): number[] {
  const out = new Array<number>(12).fill(0);
  const lo = Math.max(1, Math.ceil(30 / binHz));
  const hi = Math.min(power.length - 1, Math.floor(8000 / binHz));
  let total = 0;
  for (let i = lo; i <= hi; i++) {
    const midi = 69 + 12 * Math.log2((i * binHz) / 440);
    out[((Math.round(midi) % 12) + 12) % 12] += power[i];
    total += power[i];
  }
  return total > 0 ? out.map((v) => v / total) : out;
}

export interface NoteReport {
  silent: boolean;
  /** Share of energy on the first 16 harmonics of the claimed note. Low means atonal. */
  harmonicity: number;
  /** Share of energy on the claimed note's pitch class. Low means overtones have taken over. */
  rootShare: number;
  /** Share of harmonic energy in the first harmonic alone. */
  fundamental: number;
  /** Which harmonic is strongest. */
  strongest: number;
  /** How far that harmonic sits from where it should. */
  tuningCents: number;
  /** Late level over early level. Near 1 holds, near 0 dies away. */
  holds: number;
  level: number;
}

const WINDOW = { early: [0.05, 0.25], late: [0.95, 1.15] };

export function analyzeNote(x: Float32Array, sr: number, midi: number): NoteReport {
  const slice = (a: number, b: number) => x.subarray(Math.round(a * sr), Math.min(x.length, Math.round(b * sr)));
  const level = rms(x);
  const silent = level < 1e-4;
  const spec = wholeSpectrum(x, sr);
  const f0 = midiToHz(midi);
  const { power, binHz } = spec;

  const harmonics: number[] = [];
  let bestK = 1;
  let bestP = -1;
  let bestBin = 0;
  let onHarmonics = 0;
  for (let k = 1; k <= 16; k++) {
    const hz = k * f0;
    if (hz > sr / 2 - 100) break;
    // A semitone wide at most, and never overlapping the next harmonic.
    const halfWidth = Math.min(hz * (2 ** (50 / 1200) - 1), f0 / 2);
    const a = Math.max(1, Math.ceil((hz - halfWidth) / binHz));
    const b = Math.min(power.length - 1, Math.floor((hz + halfWidth) / binHz));
    let sum = 0;
    let peak = -1;
    let peakBin = a;
    for (let i = a; i <= b; i++) {
      sum += power[i];
      if (power[i] > peak) {
        peak = power[i];
        peakBin = i;
      }
    }
    harmonics.push(sum);
    onHarmonics += sum;
    if (sum > bestP) {
      bestP = sum;
      bestK = k;
      bestBin = peakBin;
    }
  }
  const top = Math.min(power.length - 1, Math.floor((16.5 * f0) / binHz));
  let total = 0;
  for (let i = Math.ceil(20 / binHz); i <= top; i++) total += power[i];

  const c = chroma(spec);
  return {
    silent,
    harmonicity: total > 0 ? onHarmonics / total : 0,
    rootShare: c[((midi % 12) + 12) % 12],
    fundamental: onHarmonics > 0 ? harmonics[0] / onHarmonics : 0,
    strongest: bestK,
    tuningCents: bestBin ? 1200 * Math.log2((bestBin * binHz) / (bestK * f0)) : 0,
    holds: rms(slice(WINDOW.early[0], WINDOW.early[1])) > 0
      ? rms(slice(WINDOW.late[0], WINDOW.late[1])) / rms(slice(WINDOW.early[0], WINDOW.early[1]))
      : 0,
    level,
  };
}

/** Share of a chord's energy on its own pitch classes. */
export function chordShare(x: Float32Array, sr: number, pcs: number[]): number {
  const c = chroma(wholeSpectrum(x, sr));
  return pcs.reduce((sum, pc) => sum + c[pc], 0);
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : 0;
};

export interface Summary {
  harmonicity: number;
  rootShare: number;
  worstRootShare: number;
  fundamental: number;
  tuningCents: number;
  holds: number;
  chord: number;
}

export function summarize(notes: NoteReport[], chord: number): Summary {
  const live = notes.filter((n) => !n.silent);
  return {
    harmonicity: median(live.map((n) => n.harmonicity)),
    rootShare: median(live.map((n) => n.rootShare)),
    worstRootShare: live.length ? Math.min(...live.map((n) => n.rootShare)) : 0,
    fundamental: median(live.map((n) => n.fundamental)),
    tuningCents: median(live.map((n) => Math.abs(n.tuningCents))),
    holds: median(live.map((n) => n.holds)),
    chord,
  };
}

/**
 * The bar. A sawtooth, the brightest sound everyone hears as plainly in tune, has a root share of
 * about 0.8, so the root bar leaves plenty of room below it for real overtones.
 */
export const BAR = {
  harmonicity: 0.75,
  rootShare: 0.45,
  chord: 0.7,
  tuningCents: 30,
  /** A median hides one note gone badly wrong, which you'd still hit while playing. */
  worstRootShare: 0.2,
  /** Under this, the note has gone completely within a second. */
  holds: 0.02,
};

/**
 * A sharp attack can miss the harmonicity and chord bars narrowly on a sound that's clean once it's
 * sounding. Numbers shouldn't delete those, so close misses go to the ear instead.
 */
export const CLOSE = { harmonicity: 0.6, chord: 0.6 };

export type Tier = "keep" | "listen" | "drop";

export function verdict(s: Summary): { tier: Tier; keep: boolean; why: string[] } {
  const why: string[] = [];
  let close = true;
  const fail = (reason: string, isClose = false) => {
    why.push(reason);
    close &&= isClose;
  };
  if (s.harmonicity < BAR.harmonicity) {
    fail(`atonal: only ${pct(s.harmonicity)} of its energy is on the note's harmonics`, s.harmonicity >= CLOSE.harmonicity);
  }
  if (s.rootShare < BAR.rootShare) fail(`overtones take over: only ${pct(s.rootShare)} of its energy is on the claimed note`);
  if (s.worstRootShare < BAR.worstRootShare) fail(`one note goes badly wrong: only ${pct(s.worstRootShare)} on the claimed note`);
  if (s.chord < BAR.chord) fail(`a chord loses its notes: only ${pct(s.chord)} of its energy is on the chord's notes`, s.chord >= CLOSE.chord);
  if (s.tuningCents > BAR.tuningCents) fail(`out of tune by about ${Math.round(s.tuningCents)} cents`);
  if (s.holds < BAR.holds) fail("dies away completely within a second");
  const tier: Tier = why.length === 0 ? "keep" : close ? "listen" : "drop";
  return { tier, keep: tier !== "drop", why };
}
const pct = (v: number) => `${Math.round(v * 100)}%`;
