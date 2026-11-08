# Architecture

Almagest is a Svelte 5 and TypeScript app built with Vite. It has two jobs that pull against each other. Sound has to start within a few milliseconds of a touch, and the screen has to explain a lot. So sound never waits for drawing, and each piece of the screen is a separate module that can be rebuilt without touching the others.

```
 touch ──▶ module ──intent──▶ core ──▶ theory (pure)
              ▲                 │
              │                 ├──▶ voice bank ──▶ Parallax engines ──▶ speaker
              └───── view ◀─────┘
```

## Layers

| Folder | What it holds | Rules |
|---|---|---|
| `src/theory/` | Spelling, the key, next-chord odds, voicing, named progressions | Pure functions. No UI or audio imports. The most heavily tested part. |
| `src/core/` | State, intents, the reducer, gestures, the view each module reads, the module contract | Pure apart from one store. Knows nothing of modules, skins, voices or Parallax. |
| `src/voices/` | The voice bank, the engines, the room, keeping audio alive | The only code that touches Web Audio. |
| `src/modules/` | The circle, the readout, the voices panel, the pads, the controls, the Menu | Each may import only `core/contract` and its own folder. |
| `src/skins/` | Design tokens, and which module fills each slot on the stage | Data, not code. |
| `src/app/` | Mounting, starting audio, saved settings, install behavior | |

A test, `src/modules/modules.test.ts`, enforces this structure. A failure there means the structure broke, not the feature.

## The path from a touch to sound

1. A finger goes down on the circle. The circle module finds the chord under it and reports the touch: which chord, where in polar terms, and when.
2. `core/gestures.ts` turns touches into intents. A press becomes "play this chord" at once. Holds, slides, swipes and long presses are decided afterward, from what the finger does next, so no gesture ever delays the first sound.
3. `core/reduce.ts` takes the state and the intent and returns the new state plus a list of voice commands: strike, slide or release, per voice. It's pure and fast, because it runs inside the touch handler.
4. `core/core.ts` hands the commands to the voice bank first, then updates the stores, and the modules redraw on the next frame.

The voices panel never analyzes audio. The reducer produces one voiced chord and derives both the commands and the drawing from it, so what's drawn is exactly what was sent.

## Modules and the contract

`src/core/contract.ts` defines every slot's view and every intent. A module is a Svelte component that takes two props: a read-only store with its own slot's view, and a `send` function for intents. It can't compute anything about music, so the view carries everything a module might want to draw, including each in-key chord's function. That way no module has to rely on color to show it.

Each slot has a stub module. A test plays the whole app with each real module swapped for its stub in turn and checks that the sound doesn't change. That's what proves a module can be thrown out and rebuilt.

A skin is design tokens (CSS custom properties) plus which module fills each slot and where the slot sits on the 998 × 448 stage. There's one skin, the star atlas, but the layer stays because it keeps looks and geometry out of the modules.

## Sound

The engines come from [Parallax](https://github.com/rauscha/parallax), a separate repository included as a submodule in `vendor/parallax`. Nothing in it is changed.

- **One engine per voice.** Parallax's engines are monophonic, and each one's WebAssembly keeps its state in globals. So five voices are five `AudioWorkletNode`s, each with its own instance. They're created once, when the first touch starts the audio, and reused from then on.
- **Two engines.** The pad synth is plain JavaScript. The multi-model oscillator is WebAssembly. `src/voices/catalog.ts` lists the sounds offered under the app's own names, and `src/voices/engines.ts` adds the one thing the engines lack: a glide on the audio clock.
- **Shared notes hold.** When the next chord arrives, a voice already on the right pitch gets no command at all and keeps sounding. A voice that moves either strikes its new note or glides to it, as a ramp on its pitch parameter. Past a voice's reach, a glide falls back to a strike.
- **Two traps, both tested.** After a glide, `noteOff` must name the note that voice originally struck, or the engine ignores it. And a glide still under way has to be canceled before the next `noteOn`, or it carries on from the new note.
- **The room.** `src/voices/space.ts` adds a chorus and a reverb from Web Audio's own nodes. A limiter sits at the end of the chain.
- **Staying alive.** `src/voices/keeper.ts` fades and suspends the audio when the app goes to the background, since voices cost full CPU whenever they exist. It resumes on return, and rebuilds the audio if the phone left it running but silent.

`vite.config.ts` serves `vendor/parallax/public` byte for byte in development, so worklets and WebAssembly load exactly as shipped, and copies only the two engines' files into a build.

## The app around it

- **Settings** (key, sound, voicing, next-chord collection and the rest) are saved with idb-keyval whenever they change.
- **Offline and updates.** A service worker keeps a full copy. Each launch checks for a newer build and switches to it before the first touch. Offline, the app opens at once from the saved copy. A build that arrives mid-play waits for the next launch, so nothing ever reloads under your hands.
- **Full screen.** Installed, the manifest's `fullscreen` display mode hides the system bars. The Fullscreen API is used only in a browser tab, because when installed it brings back an "exit full screen" prompt on every wake. `src/app/install.ts` holds the rule.

## Testing

- `npm test` runs the unit tests: theory, the reducer and views, the voice bank with fake engines, the module contract and swaps, and the analysis behind the tools below.
- `npm run check` type-checks everything with svelte-check.
- `tools/verify/` drives the real app in Chromium with real touch events: sound from every sound, layout without wraps or overflow, gestures, pads and the Menu, install behavior, and updates. Unit tests passing doesn't prove the app runs, so these do.
- `tools/survey/` is a spectral survey. It plays every candidate sound through its real engine and measures whether it plays the notes it claims. A unit test holds the sound list to its results.
- `tools/slides/` measures glides and strikes through the real engines, faster than real time, including both traps above.
- `tools/corpus/transitions.py` counts the next-chord odds into `src/theory/corpus.json`. See [HOW-IT-WORKS.md](HOW-IT-WORKS.md).
