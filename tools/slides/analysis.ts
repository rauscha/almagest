/**
 * What a slide should be, measured: the pitch moves without a new attack, lands in tune, and stops when
 * told. Pure, so it can be tested on signals whose answer is known.
 */
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export interface PitchFrame {
  t: number;
  midi: number | null;
  /** How periodic this frame is, 0 to 1. */
  clarity: number;
}

/** Pitch over time by normalized autocorrelation, taking the shortest lag that's nearly the best. */
export function pitchTrack(
  x: Float32Array,
  sr: number,
  { loMidi = 30, hiMidi = 100, frameS = 0.03, hopS = 0.01 } = {},
): PitchFrame[] {
  const n = Math.round(frameS * sr);
  const hop = Math.round(hopS * sr);
  const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
  const minLag = Math.floor(sr / hz(hiMidi));
  const maxLag = Math.min(n - 1, Math.ceil(sr / hz(loMidi)));
  const out: PitchFrame[] = [];
  for (let start = 0; start + n + maxLag < x.length; start += hop) {
    const nccf = new Float64Array(maxLag + 2);
    let e0 = 0;
    for (let i = 0; i < n; i++) e0 += x[start + i] * x[start + i];
    if (e0 < 1e-7) {
      out.push({ t: (start + n / 2) / sr, midi: null, clarity: 0 });
      continue;
    }
    let best = 0;
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let num = 0;
      let e1 = 0;
      for (let i = 0; i < n; i++) {
        num += x[start + i] * x[start + i + lag];
        e1 += x[start + i + lag] * x[start + i + lag];
      }
      nccf[lag] = num / Math.sqrt(e0 * e1 + 1e-20);
      if (lag <= maxLag && nccf[lag] > best) best = nccf[lag];
    }
    let chosen = -1;
    for (let lag = minLag + 1; lag <= maxLag; lag++) {
      if (nccf[lag] >= best * 0.93 && nccf[lag] >= nccf[lag - 1] && nccf[lag] >= nccf[lag + 1]) {
        chosen = lag;
        break;
      }
    }
    if (chosen < 0) {
      out.push({ t: (start + n / 2) / sr, midi: null, clarity: best });
      continue;
    }
    const a = nccf[chosen - 1];
    const b = nccf[chosen];
    const c = nccf[chosen + 1];
    const denom = a - 2 * b + c;
    const shift = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
    out.push({ t: (start + n / 2) / sr, midi: hzToMidi(sr / (chosen + shift)), clarity: best });
  }
  return out;
}

/** Median pitch from `from` to `to` seconds. */
export function pitchAt(track: PitchFrame[], from: number, to: number): number | null {
  const v = track.filter((f) => f.t >= from && f.t <= to && f.midi !== null).map((f) => f.midi as number);
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  return v[v.length >> 1];
}

export const rms = (x: Float32Array, from: number, to: number, sr: number) => {
  const a = Math.max(0, Math.round(from * sr));
  const b = Math.min(x.length, Math.round(to * sr));
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};

/**
 * Compares the level after a moment with the level just before it. A new attack shows as a jump on a
 * sound that was dying away, or as a dip as the old note is cut.
 */
export function levelChange(x: Float32Array, at: number, sr: number, { before = 0.06, after = 0.12, frame = 0.015 } = {}) {
  const base = rms(x, at - before, at, sr);
  let max = 0;
  let min = Infinity;
  for (let t = at; t + frame <= at + after; t += frame / 2) {
    const r = rms(x, t, t + frame, sr);
    if (r > max) max = r;
    if (r < min) min = r;
  }
  return { jump: base > 0 ? max / base : 0, dip: base > 0 ? min / base : 0, base };
}
