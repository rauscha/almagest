import { describe, expect, it } from "vitest";
import { levelChange, pitchAt, pitchTrack, rms } from "./analysis";

const SR = 48000;
const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** A rich tone whose pitch and level follow the given curves. */
function tone(seconds: number, midi: (t: number) => number, level: (t: number) => number = () => 0.3): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR));
  let phase = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    phase += (2 * Math.PI * hz(midi(t))) / SR;
    let s = 0;
    for (let k = 1; k <= 6; k++) s += Math.sin(k * phase) / k;
    x[i] = level(t) * s;
  }
  return x;
}

describe("pitch tracking on known signals", () => {
  it("reads a steady note to within a few cents", () => {
    for (const m of [48, 60, 72]) expect(pitchAt(pitchTrack(tone(0.5, () => m), SR), 0.1, 0.4)!).toBeCloseTo(m, 1);
  });
  it("follows a glide through the notes between", () => {
    const track = pitchTrack(tone(1, (t) => (t < 0.3 ? 60 : t > 0.6 ? 67 : 60 + (7 * (t - 0.3)) / 0.3)), SR);
    expect(pitchAt(track, 0.1, 0.25)!).toBeCloseTo(60, 1);
    expect(Math.abs(pitchAt(track, 0.43, 0.47)! - 63.5)).toBeLessThan(0.5);
    expect(pitchAt(track, 0.7, 0.9)!).toBeCloseTo(67, 1);
  });
  it("finds nothing in silence", () => {
    expect(pitchAt(pitchTrack(new Float32Array(SR), SR), 0, 1)).toBeNull();
  });
});

describe("level change", () => {
  it("is flat across a pitch change alone", () => {
    const x = tone(1, (t) => (t < 0.5 ? 60 : 62));
    const { jump, dip } = levelChange(x, 0.5, SR);
    expect(jump).toBeLessThan(1.2);
    expect(dip).toBeGreaterThan(0.8);
  });
  it("shows a new attack on a sound that was dying away", () => {
    const x = tone(1, () => 60, (t) => (t < 0.5 ? 0.4 * Math.exp(-6 * t) : 0.4 * Math.exp(-6 * (t - 0.5))));
    expect(levelChange(x, 0.5, SR).jump).toBeGreaterThan(2);
  });
  it("rms is zero in silence", () => {
    expect(rms(new Float32Array(1000), 0, 0.01, SR)).toBe(0);
  });
});
