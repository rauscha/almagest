/** Holds the state, runs intents, plays the sound first, then lets modules redraw. */
import { atom, computed, type ReadableAtom } from "nanostores";
import { ALTERATIONS, canAlter, cellOf, chordOf, DOMINANT_7, circleChords, fitsKey, FUNCTION_WORD, hasAlteration, PLAIN, toggleAlteration } from "../theory/keyLens";
import { majorName, minorName, withOctave } from "../theory/spell";
import { findShapes, placeShape, SHAPES, stepsPlayed } from "../theory/shapes";
import { ownSeventh } from "../theory/keyLens";
import { nextChords, PRESETS } from "../theory/transitions";
import { BASS_RANGE, movement, REGISTER, SPREADS, voice, voicesOf, type Voiced } from "../theory/voicing";
import type { Send, Slot, TendView } from "./contract";
import { altsFor, altsWith, initialState, isTop, shapeChords, leadsOf, reduce, slideFrom, RING_CHOICES, SLIDE_CHOICES, type Effect, type Internal, type State, type VoiceCommand } from "./reduce";

/** The only thing core knows about sound. `voices/bank.ts` is the real one. */
export interface Sound {
  apply(commands: VoiceCommand[]): void;
  useEngine(engine: string, model: number): void;
  useModel(model: number): void;
  useSpace?(space: State["space"]): void;
}

export interface EngineEntry {
  id: string;
  label: string;
  models: string[];
}

/**
 * A sound list can shrink between visits, and a phone may have saved a sound that's gone. Falling back
 * to the first sound beats asking an engine for one that isn't there.
 */
export function usableModels(models: Record<string, number> | undefined, catalog: EngineEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [engine, position] of Object.entries(models ?? {})) {
    const entry = catalog.find((e) => e.id === engine);
    if (entry) out[engine] = position < entry.models.length ? position : 0;
  }
  return out;
}

/** One object, always, so the ribbon can tell at a glance that its rows haven't changed. */
const RIBBON_RANGE: TendView["ribbon"]["range"] = {
  upper: [Math.min(...SPREADS.map((s) => REGISTER[s].lo)), Math.max(...SPREADS.map((s) => REGISTER[s].hi))],
  bass: [BASS_RANGE.lo, BASS_RANGE.hi],
};

const NO_ARROWS: TendView["circle"]["next"] = [];

/** A pitch class's place on the circle: seven semitones to the column. */
const columnOf = (pc: number) => (pc * 7) % 12;
const columnsOf = (voiced: Voiced) => [...new Set(voicesOf(voiced).map((m) => columnOf(m % 12)))];

function shapeOf(s: State): TendView["circle"]["shape"] {
  if (!s.current || !s.sounding) return null;
  const now = columnsOf(s.current.voiced);
  const prior = s.history[s.history.length - 2]?.voiced;
  const before = prior ? columnsOf(prior) : [];
  return { now, before, kept: now.filter((c) => before.includes(c)) };
}

/** How many next chords to show: enough to choose from, few enough to rank at a glance. */
export const NEXT_SHOWN = 3;

/**
 * Where the chord sounding might go, likeliest first: every chord the counts give (the circle shows each,
 * brighter for likelier), of which the table lists the top three. Shown from the press until the
 * sound ends, and each is the chord a press would really give, latch included.
 */
function arrowsOf(s: State): TendView["circle"]["next"] {
  // Mid-slide, the stars stay the chord pressed's, so the finger can move among them and back.
  const from = slideFrom(s);
  if (!from || !s.sounding || !s.preset) return NO_ARROWS;
  const { ref, alts, voiced } = from;
  const ranked = [...nextChords(ref, s.key, s.preset, alts)].sort((a, b) => b.p - a.p);
  return ranked.map(({ ref: target, p, source }) => {
    // The voicing engine can say what a move would cost from where the voices are now.
    const c = chordOf(target, s.key, altsFor(s, target));
    const to = voice({ root: c.root, tones: c.keep }, voiced, s.spread);
    return { ref: target, p, measured: source === "measured", cost: movement(voiced.upper, to.upper) };
  });
}
/** The next chords as the ribbon and left column list them: named as a press would give them. */
function nextNamed(s: State): TendView["ribbon"]["next"] {
  // A latch can make two cells give the same chord (Am and A, with Major latched): that's one choice,
  // so they're listed once, with their odds together.
  const merged: TendView["ribbon"]["next"] = [];
  for (const { ref, p, measured, cost } of arrowsOf(s)) {
    const { name, numeral } = chordOf(ref, s.key, altsFor(s, ref));
    const same = merged.find((m) => m.name === name);
    if (same) same.p = Math.round((same.p + p) * 1e4) / 1e4;
    else merged.push({ name, numeral, p, measured, cost });
  }
  return merged.sort((a, b) => b.p - a.p).slice(0, NEXT_SHOWN);
}

/** The chord a long press lit, named as it would play. */
function leadsNamed(s: State): TendView["circle"]["leads"] {
  const ref = leadsOf(s);
  return ref ? { ref, name: chordOf(ref, s.key, DOMINANT_7).name } : null;
}

/** The named progressions in the trail. */
const shapesIn = (s: State) => findShapes(shapeChords(s), s.key);

/** The progression loaded from the library, drawn where it falls in this key, and how far the trail is into it. */
function loadedOf(s: State): TendView["circle"]["loaded"] {
  const placed = s.loaded ? placeShape(s.loaded, s.key) : null;
  if (!placed) return null;
  const { def, steps, tonic } = placed;
  const tonicName = chordOf(cellOf(tonic.root, tonic.ring), s.key).name.replace(/m$/, "");
  const drawn = steps.map((st, i) => {
    const ref = cellOf(st.root, st.ring);
    const color = s.colored && !s.declined.includes(i) ? st.color : null;
    // The name is what a press gives when the step comes up: the shape's pad, unless a latched one wins.
    const name = chordOf(ref, s.key, altsWith(s, ref, color)).name;
    if (!color) return { ref, numeral: st.numeral, top: "", name };
    // What the pad adds to a numeral, read off the key's own numeral for the chord with and without it
    // (vi to vi7, I to Imaj7), so the shape's numerals spell it the same way the trail does.
    const plain = chordOf(ref, s.key).numeral, with7 = chordOf(ref, s.key, { ...PLAIN, top: color }).numeral;
    return { ref, numeral: st.numeral, top: with7.startsWith(plain) ? with7.slice(plain.length) : color, name };
  });
  return {
    numerals: drawn.map((st) => st.numeral + st.top).join("–"),
    name: def.name,
    where: `${tonicName} ${tonic.ring === "min" ? "minor" : "major"}`,
    steps: drawn,
    played: stepsPlayed(placed, shapeChords(s)),
  };
}

/** The Menu's order, as they'd be learned. */
const SHAPE_LIST = ["two-five-one", "circle", "axis", "andalusian", "doo-wop", "canon", "blues", "ragtime", "rock"].map((id) => {
  const d = SHAPES.find((x) => x.id === id)!;
  return { id: d.id, label: d.label };
});

/** The shape the chord now completes, if the trail ends in one. */
function shapeNow(s: State): TendView["readout"]["shape"] {
  const last = shapesIn(s).at(-1);
  if (!s.current || !last || last.to !== s.history.length - 1) return null;
  return { numerals: last.numerals, name: last.name, where: last.where };
}

function keyAndHealth(s: State) {
  const k = s.key;
  const cur = s.history[s.history.length - 1]?.voiced;
  const prev = s.history[s.history.length - 2]?.voiced;
  return {
    key: { name: k.mode === "major" ? majorName(k.col, k) : minorName(k.col, k).replace(/m$/, ""), mode: k.mode },
    moved: s.current && cur && prev ? movement(prev.upper, cur.upper) : null,
    audioOk: s.audioOk,
    sounding: !!(s.current && s.sounding),
  };
}

const PRESET_LIST = PRESETS.map(({ id, name, short }) => ({ id, name, short }));
const SPACE_LIST: State["space"][] = ["off", "room", "hall"];

function views(state: ReadableAtom<State>, catalog: EngineEntry[]) {
  const circle = computed(state, (s): TendView["circle"] => {
    const k = s.key;
    return {
      key: {
        name: k.mode === "major" ? majorName(k.col, k) : minorName(k.col, k).replace(/m$/, ""),
        mode: k.mode,
        col: k.col,
      },
      // While a pad is held, or every chord takes its 7th, each chord is named as a press would give it.
      // The mode leaves the numerals alone: it's always on, and Imaj7 at numeral size would crowd the cell.
      chords: circleChords(k).map(({ ref, name, numeral, inKey, fn }) => {
        if (!s.pads.length && !s.sevenInKey) return { ref, name, numeral, inKey, fn, plain: name };
        const as = chordOf(ref, k, altsFor(s, ref));
        return { ref, name: as.name, numeral: s.pads.length ? as.numeral : numeral, inKey, fn, plain: name };
      }),
      relabeled: s.pads.length > 0 || s.sevenInKey,
      sustain: s.sustain,
      current: s.current?.ref ?? null,
      sounding: !!(s.current && s.sounding),
      held: s.fingers.length > 0,
      moving: !!s.headDrag,
      next: arrowsOf(s),
      leads: leadsNamed(s),
      trail: s.history.map((h) => h.ref),
      shape: shapeOf(s),
      loaded: loadedOf(s),
    };
  });
  const readout = computed(state, (s): TendView["readout"] => {
    if (!s.current) return { ...keyAndHealth(s), name: "", numeral: "", relation: "", fn: null, shape: null };
    const c = chordOf(s.current.ref, s.key, s.current.alts);
    const relation = c.fn ? FUNCTION_WORD[c.fn] : "Outside the key";
    return { ...keyAndHealth(s), name: c.name, numeral: c.numeral, relation: c.raised ? `${relation}, raised` : relation, fn: c.fn, shape: shapeNow(s) };
  });
  const controls = computed(state, (s): TendView["controls"] => ({
    spread: s.spread,
    spreads: SPREADS,
    preset: s.preset,
    presets: PRESET_LIST,
    menuOpen: s.menuOpen,
    next: nextNamed(s),
  }));
  const menu = computed(state, (s): TendView["menu"] => {
    const entry = catalog.find((e) => e.id === s.engine) ?? catalog[0];
    return {
      open: s.menuOpen,
      engines: catalog.map(({ id, label }) => ({ id, label })),
      engine: entry?.id ?? "",
      models: entry?.models ?? [],
      model: s.models[s.engine] ?? 0,
      ringMs: s.ringMs,
      ringChoices: RING_CHOICES,
      slide: s.slide,
      slideMs: s.slideMs,
      slideChoices: SLIDE_CHOICES,
      space: s.space,
      spaces: SPACE_LIST,
      about: s.about,
      preset: s.preset,
      presets: PRESET_LIST,
      shapes: SHAPE_LIST,
      shape: s.loaded,
      colored: s.colored,
    };
  });
  const alterations = computed(state, (s): TendView["alterations"] => {
    const now = s.current && s.sounding ? s.current : null;
    return {
      options: ALTERATIONS.map((id) => {
        const held = s.pads.some((p) => p.pad === id);
        const latched = hasAlteration(s.latched, id);
        if (!now) return { id, chord: "", on: held || latched, latched, held, inKey: null, available: true, columns: [] };
        const has = hasAlteration(now.alts, id);
        // A 7th the mode put there isn't this pad's doing, so the pad stays unringed.
        const on = has && !(s.sevenInKey && isTop(id) && !latched && !held);
        const available = canAlter(now.ref.ring, id);
        // What this pad would give: the chord as it is if it has it, or with it added if it hasn't.
        const c = chordOf(now.ref, s.key, has || !available ? now.alts : toggleAlteration(now.alts, id));
        return { id, chord: available ? c.name : "", on, latched, held, inKey: available ? fitsKey(c, s.key) : null, available, columns: c.pcs.map(columnOf) };
      }),
      sevenInKey: s.sevenInKey,
      sevenChord: now ? chordOf(now.ref, s.key, { ...now.alts, top: ownSeventh(now.ref, s.key, now.alts.quality) }).name : "",
      chordName: now ? chordOf(now.ref, s.key, now.alts).name : "",
    };
  });
  const ribbon = computed(state, (s): TendView["ribbon"] => {
    const columns = s.history.map(({ ref, alts, voiced }) => {
      const { name, numeral } = chordOf(ref, s.key, alts);
      return { name, numeral, upper: voiced.upper, bass: voiced.bass };
    });
    const now = s.history[s.history.length - 1]?.voiced;
    const before = s.history[s.history.length - 2]?.voiced;
    const chord = s.current && s.sounding ? chordOf(s.current.ref, s.key, s.current.alts) : null;
    const sounding = chord
      ? s.sounding!.map((midi) => ({
          midi,
          name: withOctave(chord.notes[chord.pcs.indexOf(midi % 12)], midi),
          role: midi % 12 === chord.seventh ? ("7" as const) : midi % 12 === chord.ninth ? ("9" as const) : null,
        }))
      : [];
    return {
      range: RIBBON_RANGE,
      columns,
      sounding,
      leadingTone: sounding.find((n) => n.midi % 12 === chord?.leadingTone) ?? null,
      moves:
        now && before
          ? voicesOf(before).flatMap((from, voice) => {
              const to = voicesOf(now)[voice];
              return from === to ? [] : [{ from, to, bass: voice === now.upper.length }];
            })
          : [],
      cost: now && before ? movement(before.upper, now.upper) : null,
      next: nextNamed(s),
      shapes: shapesIn(s).map(({ from, to, short }) => ({ from, to, short, now: to === s.history.length - 1 })),
    };
  });
  const empty = atom({} as Record<string, never>);
  return { circle, readout, controls, menu, ribbon, alterations, practice: empty } satisfies {
    [S in Slot]: ReadableAtom<TendView[S]>;
  };
}

export function createCore(opts: {
  catalog: EngineEntry[];
  sound: Sound;
  initial?: Partial<State>;
  setTimer?: (fn: () => void, ms: number) => void;
  onSettings?: (state: State) => void;
}) {
  const state = atom<State>(initialState({ ...opts.initial, models: usableModels(opts.initial?.models, opts.catalog) }));
  const setTimer = opts.setTimer ?? ((fn, ms) => void setTimeout(fn, ms));

  const run = (intent: Internal) => {
    const before = state.get();
    const step = reduce(before, intent);
    opts.sound.apply(step.commands);
    for (const effect of step.effects) perform(effect);
    state.set(step.state);
    if (
      opts.onSettings &&
      (before.key !== step.state.key ||
        before.preset !== step.state.preset ||
        before.space !== step.state.space ||
        before.ringMs !== step.state.ringMs ||
        before.spread !== step.state.spread ||
        before.slide !== step.state.slide ||
        before.slideMs !== step.state.slideMs ||
        before.colored !== step.state.colored ||
        before.sevenInKey !== step.state.sevenInKey ||
        before.engine !== step.state.engine ||
        before.models !== step.state.models)
    ) {
      opts.onSettings(step.state);
    }
  };
  const perform = (effect: Effect) => {
    if (effect.kind === "ring") setTimer(() => run({ type: "ringEnded", token: effect.token }), effect.ms);
    else if (effect.kind === "hold") setTimer(() => run({ type: "holdElapsed", token: effect.token }), effect.ms);
    else if (effect.kind === "long") setTimer(() => run({ type: "longElapsed", token: effect.token }), effect.ms);
    else if (effect.kind === "engine") opts.sound.useEngine(effect.engine, effect.model);
    else if (effect.kind === "space") opts.sound.useSpace?.(effect.space);
    else opts.sound.useModel(effect.model);
  };
  const send: Send = (intent) => run(intent);
  /** Stops every note, for when the app goes away. Not for modules. */
  const silenceAll = () => run({ type: "appHidden" });
  /** How the app is running, for the menu to show. Not for modules. */
  const setAbout = (about: string) => run({ type: "aboutChanged", about });
  const setAudio = (ok: boolean) => run({ type: "audioChanged", ok });
  return { send, silence: silenceAll, setAbout, setAudio, views: views(state, opts.catalog), state: state as ReadableAtom<State> };
}
export type Core = ReturnType<typeof createCore>;
