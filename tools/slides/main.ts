/**
 * Plays slides and strikes through the real engines, faster than real time, and measures what happened.
 * Run from a browser, since the engines are AudioWorklets.
 */
import { makeEngine } from "../../src/voices/engines";
import { CATALOG, engineKnobs, engineModelIndex } from "../../src/voices/catalog";
import { canGlide } from "../../src/voices/glide";
import { levelChange, pitchAt, pitchTrack, rms } from "./analysis";

const SR = 48000;
const quantum = 128 / SR;
const snap = (t: number) => Math.ceil(t / quantum) * quantum;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const status = (s: string) => {
  const el = document.getElementById("status");
  if (el) el.textContent = s;
};

/** A timeline that stops at each step so that what was just sent lands before rendering carries on. */
async function rig(engine: string, seconds: number) {
  const off = new OfflineAudioContext(1, Math.ceil(SR * seconds), SR);
  let at = snap(0.25);
  let stop = off.suspend(at);
  const rendering = off.startRendering();
  const voice = makeEngine(engine);
  await voice.init(off as unknown as AudioContext);
  voice.output?.connect(off.destination);
  await stop;
  const step = async (s: number) => {
    await sleep(25);
    const from = at;
    at = snap(at + s);
    stop = off.suspend(at);
    await off.resume();
    await stop;
    return from;
  };
  return {
    voice, step, now: () => at, ctx: off,
    finish: async () => {
      off.resume();
      return (await rendering).getChannelData(0);
    },
  };
}

const glider = (v: ReturnType<typeof makeEngine>) => {
  if (!canGlide(v)) throw new Error("this voice can't slide");
  return v;
};

interface SoundRow {
  engine: string; name: string;
  slideJump: number; slideDip: number; strikeJump: number; strikeDip: number;
  landedCents: number | null; level1s: number;
}

/** One sound: strike, slide a 5th, and compare with the same move struck. */
async function surveySounds(): Promise<SoundRow[]> {
  const rows: SoundRow[] = [];
  for (const entry of CATALOG) {
    const perCase = 3.4;
    const r = await rig(entry.id, 0.5 + entry.models.length * perCase * 2);
    const plan: { name: string; mode: string; at: number; on: number }[] = [];
    for (let m = 0; m < entry.models.length; m++) {
      status(`${entry.id}: ${entry.models[m]}`);
      r.voice.setParameter("model", engineModelIndex(entry.id, m));
      for (const [knob, value] of Object.entries(engineKnobs(entry.id, m))) r.voice.setParameter(knob, value);
      await r.step(0.1);
      for (const mode of ["slide", "strike"]) {
        const on = r.now();
        r.voice.noteOn(60, { time: on });
        await r.step(0.6);
        const at = r.now();
        if (mode === "slide") glider(r.voice).glide(60, 67, 0.08);
        else r.voice.noteOn(67, { time: at });
        await r.step(1.4);
        r.voice.noteOff(mode === "slide" ? 60 : 67);
        await r.step(1.0);
        plan.push({ name: entry.models[m], mode, at, on });
      }
    }
    const x = await r.finish();
    for (const name of entry.models) {
      const s = plan.find((p) => p.name === name && p.mode === "slide")!;
      const k = plan.find((p) => p.name === name && p.mode === "strike")!;
      const a = levelChange(x, s.at, SR);
      const b = levelChange(x, k.at, SR);
      const track = pitchTrack(x.subarray(Math.round((s.at + 0.2) * SR), Math.round((s.at + 1.3) * SR)), SR);
      const landed = pitchAt(track, 0, 1.1);
      rows.push({
        engine: entry.id, name,
        slideJump: a.jump, slideDip: a.dip, strikeJump: b.jump, strikeDip: b.dip,
        landedCents: landed === null ? null : (landed - 67) * 100,
        level1s: rms(x, s.at + 1.2, s.at + 1.35, SR) / Math.max(1e-9, rms(x, s.on + 0.05, s.on + 0.2, SR)),
      });
    }
  }
  return rows;
}

interface Check { engine: string; name: string; pass: boolean; detail: string }

/** A plain sustained sound for each engine, so the traps aren't hidden by a decay. */
const PLAIN: Record<string, string> = { multi: "Classic Waveshapes + Filter", pad: "Soft Saw" };

async function traps(engine: string): Promise<Check[]> {
  const out: Check[] = [];
  const check = (name: string, pass: boolean, detail: string) => out.push({ engine, name, pass, detail });
  const entry = CATALOG.find((e) => e.id === engine)!;
  const position = entry.models.indexOf(PLAIN[engine]);
  const r = await rig(engine, 16);
  r.voice.setParameter("model", engineModelIndex(engine, position));
  for (const [knob, value] of Object.entries(engineKnobs(engine, position))) r.voice.setParameter(knob, value);
  await r.step(0.1);

  // Wide slides, up and down, each measured against the note it should reach.
  const wide: { to: number; at: number }[] = [];
  for (const to of [7, 12, 24, 36, -12, -24]) {
    const from = to < 0 ? 72 : 48;
    r.voice.noteOn(from, { time: r.now() });
    await r.step(0.25);
    glider(r.voice).glide(from, from + to, 0.08);
    wide.push({ to: from + to, at: r.now() });
    await r.step(0.5);
    r.voice.noteOff(from);
    await r.step(0.2);
  }

  // The glide itself, slow enough to see.
  r.voice.noteOn(60, { time: r.now() });
  await r.step(0.3);
  const slowAt = r.now();
  glider(r.voice).glide(60, 67, 0.3);
  await r.step(0.6);
  r.voice.noteOff(60);
  await r.step(0.2);

  // A slide interrupted midway must carry on from where it had got to.
  r.voice.noteOn(60, { time: r.now() });
  await r.step(0.3);
  const brokenAt = r.now();
  glider(r.voice).glide(60, 72, 0.4);
  await r.step(0.1);
  glider(r.voice).glide(60, 60, 0.2);
  await r.step(0.5);
  r.voice.noteOff(60);
  await r.step(0.2);

  // After a slide, noteOff naming the struck note must stop the voice.
  r.voice.noteOn(60, { time: r.now() });
  await r.step(0.3);
  glider(r.voice).glide(60, 65, 0.05);
  await r.step(0.3);
  const offAt = r.now();
  r.voice.noteOff(60);
  await r.step(1.5);
  const silentAt = r.now();

  // A strike straight after a slide must be the note asked for, with no bend left on it.
  r.voice.noteOn(60, { time: r.now() });
  await r.step(0.3);
  glider(r.voice).glide(60, 67, 0.05);
  await r.step(0.2);
  const strikeAt = r.now();
  r.voice.noteOn(72, { time: strikeAt });
  await r.step(0.4);
  r.voice.noteOff(72);
  await r.step(0.2);

  // The same, while the slide is still going.
  r.voice.noteOn(60, { time: r.now() });
  await r.step(0.3);
  glider(r.voice).glide(60, 72, 1);
  await r.step(0.1);
  const midStrikeAt = r.now();
  r.voice.noteOn(55, { time: midStrikeAt });
  await r.step(1.2);
  r.voice.noteOff(55);
  await r.step(0.1);

  const x = await r.finish();
  const trackFor = (a: number, b: number) => pitchTrack(x.subarray(Math.round(a * SR), Math.round(b * SR)), SR);
  const cents = (got: number | null, want: number) => (got === null ? Infinity : Math.abs(got - want) * 100);

  for (const { to, at } of wide) {
    const got = pitchAt(trackFor(at + 0.2, at + 0.5), 0, 0.3);
    check(`a slide reaches ${to}`, cents(got, to) < 15, `${got?.toFixed(2)}`);
  }
  const slow = trackFor(slowAt - 0.05, slowAt + 0.5);
  const inBetween = slow.filter((f) => f.midi !== null && f.midi > 60.7 && f.midi < 66.3).length;
  check("a 300 ms slide passes through the notes between", inBetween >= 10, `${inBetween} frames between`);

  const broken = trackFor(brokenAt - 0.05, brokenAt + 0.55).filter((f) => f.midi !== null).map((f) => f.midi as number);
  let worst = 0;
  for (let i = 1; i < broken.length; i++) worst = Math.max(worst, Math.abs(broken[i] - broken[i - 1]));
  check("a slide interrupted midway doesn't jump", worst < 1.5, `largest step ${worst.toFixed(2)} semitones per 10 ms`);

  const before = rms(x, offAt - 0.1, offAt, SR);
  const after = rms(x, silentAt - 0.2, silentAt, SR);
  check("noteOff after a slide stops the voice", after < before * 0.05, `${(after / before).toFixed(4)} of its level`);

  const struck = pitchAt(trackFor(strikeAt + 0.1, strikeAt + 0.38), 0, 0.28);
  check("a strike after a slide has no bend left on it", cents(struck, 72) < 15, `${struck?.toFixed(2)}`);
  const midStruck = pitchAt(trackFor(midStrikeAt + 0.15, midStrikeAt + 1.15), 0, 1);
  check("a strike during a slide stops the slide", cents(midStruck, 55) < 15, `${midStruck?.toFixed(2)}`);
  return out;
}

export async function run() {
  const checks = [...(await traps("multi")), ...(await traps("pad"))];
  status("Sounds");
  const sounds = await surveySounds();
  status("Done");
  return { checks, sounds };
}

Object.assign(window, { __slides: run });
