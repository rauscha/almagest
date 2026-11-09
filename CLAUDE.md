# CLAUDE.md

Guidance for Claude Code and other coding agents working in this repository. People should start with `README.md`.

**Almagest** is a polyphonic circle-of-fifths chord instrument that teaches harmony, built as a PWA for Android phones in landscape.

**Read first:** `docs/ARCHITECTURE.md` (layers and sound), `docs/HOW-IT-WORKS.md` (the theory), `docs/GESTURES.md`, `DESIGN.md` (the visual system), and `docs/DECISIONS.md` (decisions since the repository started). A `CLAUDE.local.md` beside this file, if there is one, holds one machine's own notes and is not committed.

## Commands

- `npm run dev`: Vite on `127.0.0.1:5173`, bound to localhost on purpose. To reach it from a phone, put a TLS proxy in front of it and set `DEV_HOST` and `DEV_PORT` in `.env.local`.
- `npm test`: Vitest over `src/` and `tools/`. One file or test: `npx vitest run src/theory/theory.test.ts -t "spells"`.
- `npm run check`: svelte-check. It prints a harmless line about failing to load Parallax's Vite config.
- `npm run build`, then `npm run preview` to serve the build on `127.0.0.1:4173`.
- A push to `main` deploys the public app through `.github/workflows/deploy.yml`. Check the live build afterward.
- `tools/verify/*.cjs`: browser checks against `ALMAGEST_URL` (default: the dev server). `layout.cjs` and `drive_app.cjs` are the two to run after any UI change, and `midi.cjs` after any change to MIDI. They need Playwright's Chromium.
- Clone with `--recurse-submodules`, since the sound engines are a submodule.

## Rules

- **`vendor/parallax` is read-only.** It's a separate repository (submodule). Changes to an engine go upstream, not here.
- **Theory stays pure:** `src/theory/` is TypeScript with Vitest tests and no UI or audio imports. Musical correctness is the main risk.
- **Readable without color.** Every distinction must survive desaturation: size, brightness, rings, line style, shading or a label carries the meaning, and hue is only flavor. Check a grayscale screenshot.
- **No upstream product names in the UI.** The engines derive from other projects. Credit them factually in the README and licenses, but on screen use the app's own labels ("Multi-model", "Pad synth").
- **Modules import only `core/contract`.** `src/modules/modules.test.ts` enforces the structure, so a failure there means the structure broke.
- **Log decisions** in `docs/DECISIONS.md`: what was decided, why, and how it was checked.

## Traps that have already bitten

- An SVG button with `tabindex` keeps the browser's focus box after a tap, on phones too. `preventDefault` its `mousedown`, as Sustain does.

- Don't set `resolve.conditions` outside tests in `vite.config.ts`. It hands the live app Svelte's server build, and every unit test still passes.
- `noteOff` is ignored unless it names the note that voice struck, so a slide must not update `struck`.
- A scheduled slide carries on after a `noteOn` unless it's canceled first. `src/voices/engines.ts` does this, and `tools/slides/` checks it.
- The sound list is held to `tools/survey/results.json` by a test. Changing it means re-running the survey (`tools/survey/`, and `tools/verify/survey_presets.cjs` for sounds that are knob settings) or recording a listening verdict in `src/voices/catalog.ts`.
- Saved settings live under one versioned key in `src/app/main.ts`. Bump the key when a default or the sound list changes, or used installs keep the old value, and carry the other fields over from the previous key.
- Unit tests don't prove the app runs. Open it in a browser and look at a screenshot before calling something done.
- Never call the Fullscreen API when installed. It brings back an exit prompt on every wake. `src/app/install.ts` holds the rule.
- Playwright's `page.evaluate` counts as a user gesture, so it can hide a silent first press. `tools/verify/install.cjs` has the page measure that itself.
- Vite hot-reloads the open page when source changes, which interrupts anyone playing the dev server.
- Sound settings are behind the Menu, so a browser script has to open it first. Chords and pads stay playable with it open.
- Scripts find a chord by `[data-chord="<plain name>"]`, which stays put while a held pad relabels the cell; a pad by `.pad:has(:is(.label, .ring):text-is("7"))`; a voicing stop by `[data-stop="wide"]`; a sound by `.sound[aria-label="<full name>"]`, since labels can be shortened on screen.
- Next-chord numbers come from `src/theory/corpus.json`. Re-run `tools/corpus/transitions.py` (with `python3 -I`, corpora downloaded outside the repo) rather than editing the JSON by hand.

## How the app reaches Parallax

Parallax's engines are monophonic, and each worklet's WebAssembly keeps its state in per-instance globals. So N voices are N `AudioWorkletNode`s, each with its own instance (16 MB of heap each for the multi-model oscillator; the pad synth is plain JavaScript). Nothing in Parallax changes for this.

Three pieces of `vite.config.ts` make it work:

- `/parallax/*` serves `vendor/parallax/public` byte for byte, skipping Vite's transforms, so worklets and `.wasm` load exactly as shipped. A build copies only the two engines' files.
- Vendored TypeScript (`vendor/parallax/src/data/*`) is imported directly. Vite then reads Parallax's `tsconfig.json`, which is why `@tsconfig/svelte` is a dev dependency.
- `optimizeDeps.entries` keeps Vite's dependency scan out of Parallax's own HTML files.
