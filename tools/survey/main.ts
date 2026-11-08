/**
 * Renders every sound through the real engines, faster than real time, and reports whether each
 * plays the notes it claims. Run from a browser, since the engines are AudioWorklets.
 */
import { PlaitsEngine } from "../../vendor/parallax/src/audio/engines/PlaitsEngine";
import { LaxsynthEngine } from "../../vendor/parallax/src/audio/engines/LaxsynthEngine";
import { MULTI, PAD, type SoundPreset } from "../../src/voices/catalog";
import { PLAITS_MODELS } from "../../vendor/parallax/src/data/plaits-models";
import type { ISynthEngine } from "../../vendor/parallax/src/audio/types";
import { analyzeNote, chordShare, summarize, verdict, type Tier } from "./analysis";

const SR = 48000;
const NOTE_S = 1.3;
const GAP_S = 0.5;
/** A pad's release outlasts the usual gap, and would bleed into the next note's reading. */
const PAD_GAP_S = 2.2;
/** Bass and upper registers, across the range the voices use. */
const NOTES = [43, 48, 57, 60, 64, 69, 76];
const CHORDS = [
  { midi: [60, 64, 67, 72, 48], pcs: [0, 4, 7] }, // C major
  { midi: [57, 60, 64, 69, 45], pcs: [9, 0, 4] }, // A minor
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (s: string) => {
  const el = document.getElementById("status");
  if (el) el.textContent = s;
};

interface Row {
  engine: string;
  name: string;
  code: string;
  summary: ReturnType<typeof summarize>;
  tier: Tier;
  why: string[];
  notes: { midi: number; rootShare: number; harmonicity: number; strongest: number; holds: number }[];
}

async function survey(
  label: string,
  make: () => ISynthEngine,
  models: { name: string; code: string; index: number }[],
  modelValue: (m: { index: number }, position: number) => number,
  opts: { gap?: number; knobs?: (position: number) => Record<string, number> } = {},
): Promise<Row[]> {
  const GAP = opts.gap ?? GAP_S;
  const perModel = NOTES.length * (NOTE_S + GAP) + CHORDS.length * (NOTE_S + GAP);
  const lead = 0.25;
  const off = new OfflineAudioContext(1, Math.ceil(SR * (lead + models.length * perModel + 1)), SR);
  const quantum = 128 / SR;
  const snap = (t: number) => Math.ceil(t / quantum) * quantum;

  // Offline rendering outruns a worklet's async start, so suspend first and let it land.
  let at = snap(lead);
  let stop = off.suspend(at);
  const rendering = off.startRendering();
  const voices: ISynthEngine[] = [];
  for (let i = 0; i < 5; i++) {
    const v = make();
    await v.init(off as unknown as AudioContext);
    v.output?.connect(off.destination);
    voices.push(v);
  }
  await stop;

  const step = async (seconds: number) => {
    await sleep(25); // let the messages land while the render is stopped
    const from = at;
    at = snap(at + seconds);
    stop = off.suspend(at);
    await off.resume();
    await stop;
    return [Math.round(from * SR), Math.round(at * SR)] as [number, number];
  };

  const plan: { model: number; notes: [number, number, number][]; chords: [number, number, number[]][] }[] = [];
  for (let m = 0; m < models.length; m++) {
    status(`${label}: rendering ${models[m].name}`);
    for (const v of voices) {
      v.setParameter("model", modelValue(models[m], m));
      for (const [k, value] of Object.entries(opts.knobs?.(m) ?? {})) v.setParameter(k, value);
    }
    const entry = { model: m, notes: [] as [number, number, number][], chords: [] as [number, number, number[]][] };
    for (const midi of NOTES) {
      voices[0].noteOn(midi, { time: off.currentTime });
      const [a, b] = await step(NOTE_S);
      voices[0].noteOff(midi, { time: off.currentTime });
      await step(GAP);
      entry.notes.push([a, b, midi]);
    }
    for (const chord of CHORDS) {
      chord.midi.forEach((midi, i) => voices[i].noteOn(midi, { time: off.currentTime }));
      const [a, b] = await step(NOTE_S);
      chord.midi.forEach((midi, i) => voices[i].noteOff(midi, { time: off.currentTime }));
      await step(GAP);
      entry.chords.push([a, b, chord.pcs]);
    }
    plan.push(entry);
  }
  off.resume();
  const buf = await rendering;
  const ch = buf.getChannelData(0);

  status(`${label}: analyzing`);
  return plan.map(({ model, notes, chords }) => {
    const reports = notes.map(([a, b, midi]) => ({ midi, ...analyzeNote(ch.subarray(a, b), SR, midi) }));
    const shares = chords.map(([a, b, pcs]) => chordShare(ch.subarray(a, b), SR, pcs));
    const summary = summarize(reports, Math.min(...shares));
    const v = verdict(summary);
    return {
      engine: label,
      name: models[model].name,
      code: models[model].code,
      summary,
      tier: reports.some((r) => r.silent) ? "drop" : v.tier,
      why: reports.some((r) => r.silent) ? [...v.why, "silent on some notes"] : v.why,
      notes: reports.map((r) => ({
        midi: r.midi, rootShare: r.rootShare, harmonicity: r.harmonicity, strongest: r.strongest, holds: r.holds,
      })),
    };
  });
}

/** Sounds that are knob settings of their own, judged at exactly those settings. */
const asModels = (list: SoundPreset[]) => list.map((p) => ({ name: p.name, code: p.name, index: p.index }));

export async function runPresets(): Promise<Row[]> {
  const extra = MULTI.filter((p) => Object.values(p.knobs).some((v) => v !== 0.5));
  const multi = await survey("multi", () => new PlaitsEngine(), asModels(extra), (m) => m.index, { knobs: (i) => extra[i].knobs });
  const pad = await survey("pad", () => new LaxsynthEngine(), asModels(PAD), (m) => m.index, { gap: PAD_GAP_S, knobs: (i) => PAD[i].knobs });
  status("Done");
  return [...multi, ...pad];
}

export async function run(): Promise<Row[]> {
  const multi = await survey("multi", () => new PlaitsEngine(), PLAITS_MODELS, (m) => m.index);
  status("Done");
  return multi;
}

Object.assign(window, { __survey: run, __surveyPresets: runPresets });
