/**
 * All state changes. Pure, and fast because it runs inside the touch handler: it returns
 * the sound to make, and the caller plays that before anything is drawn.
 */
import { type Key } from "../theory/spell";
import { canAlter, cellOf, chordOf, DOMINANT_7, hasAlteration, PLAIN, sameChord, secondaryDominant, toggleAlteration, ownSeventh, type Alteration, type Alts, type ChordRef, type Top } from "../theory/keyLens";
import { placeShape, stepsPlayed } from "../theory/shapes";
import { nextChords } from "../theory/transitions";
import { voice, voicesOf, type Spread, type Voiced } from "../theory/voicing";
import type { Intent, Ring, SpaceLevel } from "./contract";
import { columnAt, DRAG_START, HOLD_MS, LONG_MS, modeAt, moved, radialHeading, readTouch, SWIPE_COMMIT, swipeTarget } from "./gestures";

export type VoiceCommand =
  | { kind: "on"; voice: number; midi: number }
  | { kind: "slide"; voice: number; midi: number; ms: number }
  | { kind: "off"; voice: number }
  | { kind: "allOff" };

export type Effect =
  | { kind: "ring"; ms: number; token: number }
  | { kind: "hold"; ms: number; token: number }
  | { kind: "long"; ms: number; token: number }
  | { kind: "engine"; engine: string; model: number }
  | { kind: "model"; model: number }
  | { kind: "space"; space: SpaceLevel };

export interface Played {
  ref: ChordRef;
  alts: Alts;
  voiced: Voiced;
}

export interface State {
  key: Key;
  /** The finger on the home head, and where it landed. Until it's really moved, the key stays. */
  headDrag: { pointer: number; r: number; theta: number; live: boolean; fromHub: boolean } | null;
  current: Played | null;
  /** The chords the ribbon shows, oldest first, ending with the current one. */
  history: Played[];
  /**
   * The finger on a chord, for the slide onto a star (docs/GESTURES.md). `from` is the chord it pressed
   * and `trail` the history as it stood then, so sliding back restores both; `on` is the chord sounding
   * now. Moving past the threshold before the hold time means a swipe, and that touch never slides; once
   * the swipe's been judged (`judged`), nothing more happens on it. `before` is what was there before the
   * press, so a swipe can play its chord as if that chord had been pressed instead. `long` is a long
   * press: the chord that leads to the one pressed is lit, and sliding onto it plays it as a 7th.
   */
  reach: {
    pointer: number;
    r: number;
    theta: number;
    swiped: boolean;
    judged: boolean;
    long: boolean;
    from: Played;
    trail: Played[];
    on: ChordRef;
    before: { current: Played | null; history: Played[] };
  } | null;
  /** What each voice is sounding. Null means silent. */
  sounding: number[] | null;
  fingers: number[];
  /**
   * Alteration pads held down. A pad pressed while a chord was pressed is a momentary hold, and lifting it
   * puts the latch back as it was (`before`); a plain tap leaves the latch changed.
   */
  pads: { pad: Alteration; pointer: number; used: boolean; before: Alts }[];
  /** Alterations that stay on until tapped off, Major and Minor included. */
  latched: Alts;
  sustain: boolean;
  /** How the upper voices are spaced. */
  spread: Spread;
  /** Moving voices glide to their next note. Off, they strike it. */
  slide: boolean;
  slideMs: number;
  ringMs: number;
  /** The chorus and reverb around every voice. */
  space: SpaceLevel;
  /** Cancels a ring-on that's been overtaken. */
  ringToken: number;
  /** A chord's been held long enough to show where it might go. */
  arrows: boolean;
  /** Cancels a hold that's been overtaken. */
  holdToken: number;
  /** Which table the arrows come from. Null shows none. */
  preset: string | null;
  menuOpen: boolean;
  /** The progression from the library drawn on the circle, by id. */
  loaded: string | null;
  /** Whether a loaded progression is drawn with its usual 7ths and add9s (ii7–V7–Imaj7) or plain. */
  colored: boolean;
  /** Every chord takes its own 7th (Cmaj7, Dm7, G7) unless a 7th or 9th pad says otherwise. */
  sevenInKey: boolean;
  /** Steps of the loaded progression whose 7th or add9 has been tapped off, by index. */
  declined: number[];
  /** Whether the sound is running while the app's in view. The app reports it. */
  audioOk: boolean;
  /** How the app is running: what the app says, for the menu to show. */
  about: string;
  engine: string;
  /** Last model used on each engine. */
  models: Record<string, number>;
}

export const RING_CHOICES = [0, 500, 1000, 1500, 3000];
export const SLIDE_CHOICES = [40, 80, 150, 300];

export function initialState(over: Partial<State> = {}): State {
  return {
    key: { col: 0, mode: "major" },
    headDrag: null,
    current: null,
    history: [],
    reach: null,
    sounding: null,
    fingers: [],
    pads: [],
    latched: PLAIN,
    sustain: false,
    spread: "close",
    slide: true,
    slideMs: 80,
    ringMs: 1000, // 1.5 s rang a little long
    space: "room",
    ringToken: 0,
    arrows: false,
    holdToken: 0,
    preset: "pop",
    menuOpen: false,
    loaded: null,
    colored: true, // shapes carry their 7ths unless turned off
    sevenInKey: false,
    declined: [],
    audioOk: true,
    about: "",
    engine: "pad", // the pads are what chord changes want
    models: {},
    ...over,
  };
}

export type Internal =
  | Intent
  | { type: "ringEnded"; token: number }
  | { type: "appHidden" }
  | { type: "aboutChanged"; about: string }
  | { type: "audioChanged"; ok: boolean }
  | { type: "holdElapsed"; token: number }
  | { type: "longElapsed"; token: number };

export interface Step {
  state: State;
  commands: VoiceCommand[];
  effects: Effect[];
}

/**
 * Only voices whose pitch changes get a command, so a common tone is truly left alone. A voice
 * can only slide from a note it's sounding, so with nothing before, every voice strikes.
 */
export function diffVoices(
  before: number[] | null,
  next: number[],
  slide: { ms: number } | null = null,
): VoiceCommand[] {
  const out: VoiceCommand[] = [];
  next.forEach((midi, voice) => {
    if (before?.[voice] === midi) return;
    out.push(before && slide ? { kind: "slide", voice, midi, ...slide } : { kind: "on", voice, midi });
  });
  return out;
}

/** The trail: the last 8 chords played, kept to look back at while sketching. */
export const HISTORY = 8;

function remember(history: Played[], played: Played): Played[] {
  const last = history[history.length - 1];
  const same =
    last &&
    sameChord(last.ref, played.ref) &&
    JSON.stringify(last.alts) === JSON.stringify(played.alts) &&
    voicesOf(last.voiced).join() === voicesOf(played.voiced).join();
  return same ? history : [...history, played].slice(-HISTORY);
}

const slideOf = (state: State) => (state.slide ? { ms: state.slideMs } : null);

function silence(state: State): Step {
  return {
    state: { ...state, sounding: null, reach: null, ringToken: state.ringToken + 1, arrows: false, holdToken: state.holdToken + 1 },
    commands: state.sounding ? [{ kind: "allOff" }] : [],
    effects: [],
  };
}

/** The trail as a shape sees it: each chord's root and quality, a pad's 7th or 9th set aside. */
export function shapeChords(s: State) {
  return s.history.map(({ ref, alts }) => {
    const c = chordOf(ref, s.key, alts);
    const ring = alts.quality === "major" ? "maj" : alts.quality === "minor" ? "min" : ref.ring;
    return { root: c.root, ring, rootName: c.name.match(/^[A-G][♭♯𝄪]*/)?.[0] ?? c.name };
  });
}

/**
 * The pad a loaded shape asks for on this chord, when shapes carry their 7ths: pressing its next
 * step plays it as the shape writes it, Cmaj7 for Imaj7, and so does pressing the step just played again,
 * so the chord named as next is the chord a press gives.
 */
function shapeColor(state: State, ref: ChordRef): Top | null {
  if (!state.loaded || !state.colored) return null;
  const placed = placeShape(state.loaded, state.key);
  if (!placed) return null;
  const played = stepsPlayed(placed, shapeChords(state));
  for (const i of [played, played - 1]) {
    const st = placed.steps[i];
    if (st?.color && !state.declined.includes(i) && sameChord(cellOf(st.root, st.ring), ref)) return st.color;
  }
  return null;
}

/** The steps of the loaded shape that are this chord and write this pad. A shape can come back to a chord. */
function stepsWriting(state: State, ref: ChordRef, pad: Alteration): number[] {
  if (!state.loaded || !state.colored) return [];
  const placed = placeShape(state.loaded, state.key);
  return (placed?.steps ?? []).flatMap((st, i) => (st.color === pad && sameChord(cellOf(st.root, st.ring), ref) ? [i] : []));
}

/** What a newly pressed chord takes: whatever's latched, and a loaded shape's pad, where the cell allows them. */
export function altsFor(state: State, ref: ChordRef): Alts {
  return altsWith(state, ref, shapeColor(state, ref));
}

/** Whatever's latched, plus a shape's pad (`color`) unless a 7th or 9th pad is latched or held, which wins. */
export function altsWith(state: State, ref: ChordRef, color: Top | null): Alts {
  const wanted: Alteration[] = [];
  if (state.latched.top) wanted.push(state.latched.top);
  else if (state.sevenInKey) wanted.push(ownSeventh(ref, state.key, state.latched.quality));
  else if (color) wanted.push(color);
  if (state.latched.sus) wanted.push(state.latched.sus);
  if (state.latched.quality) wanted.push(state.latched.quality);
  return wanted.reduce((sum, a) => (canAlter(ref.ring, a) && !hasAlteration(sum, a) ? toggleAlteration(sum, a) : sum), PLAIN);
}

function press(state: State, ref: ChordRef, pointer: number, r: number, theta: number): Step {
  const alts = altsFor(state, ref);
  // Any pad down now is being held for chords, not tapped.
  if (state.pads.length) state = { ...state, pads: state.pads.map((p) => ({ ...p, used: true })) };
  const chord = chordOf(ref, state.key, alts);
  const voiced = voice({ root: chord.root, tones: chord.keep }, state.current?.voiced ?? null, state.spread);
  const next = voicesOf(voiced);
  // Pressing the chord already sounding strikes it again, so repeats are audible.
  const before = sameChord(state.current?.ref ?? null, ref) ? null : state.sounding;
  const played = { ref, alts, voiced };
  const history = remember(state.history, played);
  return {
    state: {
      ...state,
      current: played,
      history,
      reach: { pointer, r, theta, swiped: false, judged: false, long: false, from: played, trail: history, on: ref, before: { current: state.current, history: state.history } },
      sounding: next,
      fingers: [...state.fingers.filter((f) => f !== pointer), pointer],
      ringToken: state.ringToken + 1, // a press in the ring time connects
      arrows: false,
      holdToken: state.holdToken + 1,
    },
    commands: diffVoices(before, next, slideOf(state)),
    effects: [
      { kind: "hold", ms: HOLD_MS, token: state.holdToken + 1 },
      { kind: "long", ms: LONG_MS, token: state.holdToken + 1 },
    ],
  };
}

/** The chord a long press has lit, the pressed chord's secondary dominant. None for the diminished cell. */
export function leadsOf(state: State): ChordRef | null {
  const reach = state.reach;
  if (!reach?.long || reach.from.ref.ring === "dim") return null;
  return secondaryDominant(chordOf(reach.from.ref, state.key, reach.from.alts).root);
}

/** Changes what the sounding chord is. Common tones get no command, the same as moving to a new chord. */
function alter(state: State, alts: Alts): Step {
  const { ref, voiced: was } = state.current!;
  const chord = chordOf(ref, state.key, alts);
  const voiced = voice({ root: chord.root, tones: chord.keep }, was, state.spread);
  const notes = voicesOf(voiced);
  // With no finger down, it's ringing out, and a change is worth hearing to the end of a full ring.
  const ringing = state.fingers.length === 0 && !state.sustain && state.ringMs > 0;
  const ringToken = state.ringToken + 1;
  return {
    state: rebase({
      ...state,
      current: { ref, alts, voiced },
      history: remember(state.history, { ref, alts, voiced }),
      sounding: notes,
      ringToken,
    }),
    commands: diffVoices(state.sounding, notes, slideOf(state)),
    effects: ringing ? [{ kind: "ring", ms: state.ringMs, token: ringToken }] : [],
  };
}

/**
 * A chord changed under a finger that hasn't slid away (a pad, a new spread): what it slides from, and
 * returns to, is the chord as it is now.
 */
function rebase(state: State): State {
  const reach = state.reach;
  if (!reach || !state.current || !sameChord(reach.on, reach.from.ref)) return state;
  return { ...state, reach: { ...reach, from: state.current, trail: state.history } };
}

/** The chords a slide can reach: the stars of the chord pressed, whatever's sounding now. */
export function slideFrom(state: State): Played | null {
  const reach = state.reach;
  return reach && !sameChord(reach.on, reach.from.ref) ? reach.from : state.current;
}

/**
 * docs/GESTURES.md: once the hold has shown the stars, sliding onto one previews it, with common tones
 * held, and sliding back onto the chord pressed returns to it. Nothing else under the finger responds,
 * so wandering plays nothing by accident, and lifting keeps whatever's sounding.
 */
function reachMove(state: State, pointer: number, r: number, theta: number, ref: ChordRef | null): Step {
  const none: Step = { state, commands: [], effects: [] };
  const reach = state.reach;
  if (!reach || reach.pointer !== pointer || !state.fingers.includes(pointer) || !state.sounding) return none;
  // Moving before the stars show is a swipe, not a slide (time separates them).
  if (!reach.swiped && !state.arrows) {
    if (moved(reach.r, reach.theta, r, theta) < DRAG_START) return none;
    return swipe({ ...state, reach: { ...reach, swiped: true } }, r, theta);
  }
  if (reach.swiped) return swipe(state, r, theta);
  if (!ref || sameChord(ref, reach.on)) return none;
  const { from } = reach;
  let played: Played;
  let history: Played[];
  if (sameChord(ref, from.ref)) {
    played = from;
    history = reach.trail;
  } else {
    // The chord a long press lit plays as a 7th, star or not; any other chord must be a star.
    const leads = sameChord(leadsOf(state), ref);
    if (!leads && (!state.preset || !nextChords(from.ref, state.key, state.preset, from.alts).some((n) => sameChord(n.ref, ref)))) return none;
    const alts = leads ? DOMINANT_7 : altsFor(state, ref);
    const chord = chordOf(ref, state.key, alts);
    // Voiced from the chord pressed, so a star sounds the same however the finger got there.
    played = { ref, alts, voiced: voice({ root: chord.root, tones: chord.keep }, from.voiced, state.spread) };
    history = remember(reach.trail, played);
  }
  const notes = voicesOf(played.voiced);
  const pads = state.pads.length ? state.pads.map((p) => ({ ...p, used: true })) : state.pads;
  return {
    state: { ...state, pads, current: played, history, sounding: notes, reach: { ...reach, on: ref } },
    commands: diffVoices(state.sounding, notes, slideOf(state)),
    effects: [],
  };
}

/**
 * docs/GESTURES.md: a swipe in on a major chord plays its relative minor, and out on a minor its relative
 * major. It's judged once, when the finger has gone far enough, and commits there and then; one too
 * sideways, or the wrong way for its cell, does nothing, and either way the touch is spent. The chord it
 * gives is the one a press of that cell would have given, voiced from what came before the press, and it
 * takes the pressed chord's place in the trail.
 */
function swipe(state: State, r: number, theta: number): Step {
  const reach = state.reach!;
  const none: Step = { state, commands: [], effects: [] };
  if (reach.judged || moved(reach.r, reach.theta, r, theta) < SWIPE_COMMIT) return none;
  const target = swipeTarget(reach.from.ref, radialHeading(reach.r, reach.theta, r, theta));
  const judged = { ...state, reach: { ...reach, judged: true } };
  if (!target) return { state: judged, commands: [], effects: [] };
  const alts = altsFor(state, target);
  const chord = chordOf(target, state.key, alts);
  const played = { ref: target, alts, voiced: voice({ root: chord.root, tones: chord.keep }, reach.before.current?.voiced ?? null, state.spread) };
  const history = remember(reach.before.history, played);
  const notes = voicesOf(played.voiced);
  const pads = state.pads.length ? state.pads.map((p) => ({ ...p, used: true })) : state.pads;
  return {
    state: { ...judged, pads, current: played, history, sounding: notes, reach: { ...judged.reach!, from: played, trail: history, on: target } },
    commands: diffVoices(state.sounding, notes, slideOf(state)),
    effects: [],
  };
}

/**
 * A pad acts the moment it's touched, on a chord that's sounding. Held down, it also applies to each
 * chord pressed meanwhile, unless this touch is what took it off.
 */
export const isTop = (a: Alteration): a is Top => a === "7" || a === "maj7" || a === "9" || a === "add9";

function padDown(state: State, pad: Alteration, pointer: number): Step {
  const before = state.latched;
  // On a chord whose pad came from the loaded shape, the pad turns that step's color off or back on.
  // Going through the latch would take it off this chord and put it on every chord after.
  const sounding = state.sounding ? state.current : null;
  // With every chord taking its own 7th, a 7th or 9th pad replaces that 7th, and lifts back off to it.
  if (state.sevenInKey && sounding && isTop(pad) && canAlter(sounding.ref.ring, pad)) {
    const latched = toggleAlteration(before, pad);
    const top = latched.top ?? ownSeventh(sounding.ref, state.key, sounding.alts.quality);
    return alter({ ...state, latched, pads: [...state.pads, { pad, pointer, used: false, before }] }, { ...sounding.alts, top });
  }
  if (sounding && canAlter(sounding.ref.ring, pad) && !hasAlteration(before, pad)) {
    const steps = stepsWriting(state, sounding.ref, pad);
    const wasDeclined = steps.some((i) => state.declined.includes(i));
    if (steps.length && (wasDeclined || hasAlteration(sounding.alts, pad))) {
      const declined = wasDeclined ? state.declined.filter((i) => !steps.includes(i)) : [...state.declined, ...steps];
      return alter({ ...state, declined, pads: [...state.pads, { pad, pointer, used: false, before }] }, toggleAlteration(sounding.alts, pad));
    }
  }
  const latched = toggleAlteration(before, pad);
  const held = { ...state, latched, pads: [...state.pads, { pad, pointer, used: false, before }] };
  const current = state.current;
  if (!current || !state.sounding) return { state: held, commands: [], effects: [] };
  if (!canAlter(current.ref.ring, pad)) return { state: held, commands: [], effects: [] };
  return alter(held, toggleAlteration(current.alts, pad));
}

/** A pad held for chords goes back to how the latch was when it went down; a tap stays as it is. */
function padUp(state: State, pointer: number): Step {
  const lifted = state.pads.find((p) => p.pointer === pointer);
  const pads = state.pads.filter((p) => p.pointer !== pointer);
  if (!lifted) return { state, commands: [], effects: [] };
  // Only a hold that turned the pad on is undone. A touch that turned it off is a tap-off, held or not.
  const turnedOn = !hasAlteration(lifted.before, lifted.pad) && hasAlteration(state.latched, lifted.pad);
  const latched = lifted.used && turnedOn ? toggleAlteration(state.latched, lifted.pad) : state.latched;
  return { state: { ...state, pads, latched }, commands: [], effects: [] };
}

function release(state: State, pointer: number): Step {
  if (!state.fingers.includes(pointer)) return { state, commands: [], effects: [] };
  const fingers = state.fingers.filter((f) => f !== pointer);
  if (state.reach?.pointer === pointer) state = { ...state, reach: null };
  // No finger left, so nothing's being held, and any hold still counting never finishes.
  const after = fingers.length ? { ...state, fingers } : { ...state, fingers, arrows: false, holdToken: state.holdToken + 1 };
  if (fingers.length > 0 || state.sustain || !state.sounding) return { state: after, commands: [], effects: [] };
  if (state.ringMs === 0) return silence(after);
  const ringToken = state.ringToken + 1;
  return {
    state: { ...after, ringToken },
    commands: [],
    effects: [{ kind: "ring", ms: state.ringMs, token: ringToken }],
  };
}

/** Moves the key, silently. What's sounding carries on, and everything that names it follows the key. */
function dragHead(state: State, pointer: number, r: number, theta: number, ring: Ring): Step {
  const drag = state.headDrag;
  if (!drag || drag.pointer !== pointer) return { state, commands: [], effects: [] };
  if (!drag.live && moved(drag.r, drag.theta, r, theta) < DRAG_START) return { state, commands: [], effects: [] };
  // Deep in the middle (the hub and the diminished ring) is where a drag from the hub starts, and it
  // means nothing yet: the key waits until the finger reaches a chord (the hub as the key dial).
  if (drag.fromHub && ring === "dim") return drag.live ? { state, commands: [], effects: [] } : { state: { ...state, headDrag: { ...drag, live: true } }, commands: [], effects: [] };
  const col = columnAt(state.key.col, theta);
  const mode = modeAt(ring);
  const key = col === state.key.col && mode === state.key.mode ? state.key : { col, mode };
  return { state: { ...state, key, headDrag: drag.live ? drag : { ...drag, live: true } }, commands: [], effects: [] };
}

export function reduce(state: State, intent: Internal): Step {
  const none: Step = { state, commands: [], effects: [] };
  switch (intent.type) {
    case "touch": {
      const g = readTouch(intent);
      if (!g) return none;
      if (g.kind === "pressed") return press(state, g.ref, g.pointer, g.r, g.theta);
      if (g.kind === "headGrabbed") {
        // Touching the head plays nothing, and the head takes one finger at a time.
        if (state.headDrag) return none;
        return { state: { ...state, headDrag: { pointer: g.pointer, r: g.r, theta: g.theta, live: false, fromHub: g.fromHub } }, commands: [], effects: [] };
      }
      if (g.kind === "moved") {
        if (state.headDrag?.pointer === g.pointer) return dragHead(state, g.pointer, g.r, g.theta, g.ring);
        return reachMove(state, g.pointer, g.r, g.theta, g.ref);
      }
      // Letting go of the head is nothing to do with the chord, which rings or holds as it was.
      if (state.headDrag?.pointer === g.pointer) return { state: { ...state, headDrag: null }, commands: [], effects: [] };
      if (g.kind === "released") return release(state, g.pointer);
      if (!state.fingers.includes(g.pointer)) return none; // some other touch, such as a pad's
      return silence({ ...state, fingers: [] }); // a canceled touch can never leave a note stuck
    }
    case "appHidden": {
      // The touches that were down never get their lift, so lift them here: a pad held for chords puts the latch back.
      const lifted = state.pads.reduce((st, p) => padUp(st, p.pointer).state, state);
      return silence({ ...lifted, fingers: [], pads: [], headDrag: null, reach: null });
    }
    case "aboutChanged":
      return state.about === intent.about ? none : { state: { ...state, about: intent.about }, commands: [], effects: [] };
    case "padDown":
      return padDown(state, intent.pad, intent.pointer);
    case "padUp":
      return padUp(state, intent.pointer);
    case "holdElapsed":
      // Held long enough that moving is a slide, not a swipe, even with no stars to slide to.
      if (intent.token !== state.holdToken || !state.fingers.length) return none;
      return { state: { ...state, arrows: true }, commands: [], effects: [] };
    case "longElapsed":
      // A swipe has spent the touch; and a long press is on the chord pressed, not one slid to.
      if (intent.token !== state.holdToken || !state.fingers.length || !state.reach || state.reach.swiped) return none;
      return { state: { ...state, reach: { ...state.reach, long: true } }, commands: [], effects: [] };
    case "presetChanged":
      return { state: { ...state, preset: intent.preset, arrows: intent.preset ? state.arrows : false }, commands: [], effects: [] };
    case "audioChanged":
      return state.audioOk === intent.ok ? none : { state: { ...state, audioOk: intent.ok }, commands: [], effects: [] };
    case "trailCleared":
      return { state: { ...state, history: state.current && state.sounding ? state.history.slice(-1) : [] }, commands: [], effects: [] };
    case "shapeChosen":
      return state.loaded === intent.shape ? none : { state: { ...state, loaded: intent.shape, declined: [] }, commands: [], effects: [] };
    case "shapeColored":
      return state.colored === intent.colored ? none : { state: { ...state, colored: intent.colored, declined: [] }, commands: [], effects: [] };
    case "sevenInKeyToggled": {
      const next = { ...state, sevenInKey: !state.sevenInKey };
      const now = state.sounding ? state.current : null;
      if (!now) return { state: next, commands: [], effects: [] };
      const own = next.sevenInKey ? ownSeventh(now.ref, state.key, now.alts.quality) : shapeColor(next, now.ref);
      return alter(next, { ...now.alts, top: state.latched.top ?? own });
    }
    case "menuToggled":
      return { state: { ...state, menuOpen: !state.menuOpen }, commands: [], effects: [] };
    case "ringEnded":
      if (intent.token !== state.ringToken || state.fingers.length > 0 || state.sustain) return none;
      return silence(state);
    case "sustainToggled": {
      const sustain = !state.sustain;
      const next = { ...state, sustain, ringToken: state.ringToken + 1 };
      if (sustain || state.fingers.length > 0) return { state: next, commands: [], effects: [] };
      return silence(next);
    }
    case "spreadChanged": {
      if (intent.spread === state.spread) return none;
      const next = { ...state, spread: intent.spread };
      // In silence there's nothing to hear, so it waits for the next chord rather than adding a
      // column to the ribbon for a chord that never sounded.
      if (!state.current || !state.sounding) return { state: next, commands: [], effects: [] };
      // Revoice what's there, so a change of spread can be heard on the chord being held.
      const { ref, alts } = state.current;
      const chord = chordOf(ref, state.key, alts);
      const voiced = voice({ root: chord.root, tones: chord.keep }, state.current.voiced, intent.spread);
      const notes = voicesOf(voiced);
      return {
        state: rebase({
          ...next,
          current: { ref, alts, voiced },
          history: remember(state.history, { ref, alts, voiced }),
          sounding: notes,
        }),
        commands: diffVoices(state.sounding, notes, slideOf(state)),
        effects: [],
      };
    }
    case "slideToggled":
      return { state: { ...state, slide: !state.slide }, commands: [], effects: [] };
    case "slideTimeChanged":
      return { state: { ...state, slideMs: intent.ms }, commands: [], effects: [] };
    case "ringChanged":
      return { state: { ...state, ringMs: intent.ms }, commands: [], effects: [] };
    case "spaceChanged":
      if (intent.space === state.space) return none;
      return { state: { ...state, space: intent.space }, commands: [], effects: [{ kind: "space", space: intent.space }] };
    case "engineChanged": {
      if (intent.engine === state.engine) return none;
      const model = state.models[intent.engine] ?? 0;
      const off = silence({ ...state, engine: intent.engine, current: null, history: [] });
      return { ...off, effects: [{ kind: "engine", engine: intent.engine, model }] };
    }
    case "modelChanged":
      return {
        state: { ...state, models: { ...state.models, [state.engine]: intent.model } },
        commands: [],
        effects: [{ kind: "model", model: intent.model }],
      };
  }
}
