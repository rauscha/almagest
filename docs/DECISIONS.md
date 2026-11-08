# Decisions

What was decided, why, and how it was checked. Newest at the bottom.

## D1: A fresh start
- **Date:** 2026-11-08.
- **What:** Almagest begins here as a clean copy of an earlier private project, with its design and code carried over and its history left behind. That project's own decision log stays with it. These docs describe the app as it stands: `README.md`, `docs/ARCHITECTURE.md`, `docs/HOW-IT-WORKS.md`, `docs/GESTURES.md` and `DESIGN.md`.
- **Carried over as settled:** the star atlas look; next-chord odds counted from Hooktheory, McGill Billboard and iRb; pads that stay on until tapped off; slides and swipes; named progressions that carry their 7ths; the pad synth and multi-model engines from Parallax; readable without color.
- **Not built yet:** the flick across the center for a tritone substitute; guided walks through progressions; MIDI out, which will send exactly what the voices do.

## D2: Only percentages from the corpora
- **Date:** 2026-11-08.
- **What:** `src/theory/corpus.json` keeps each next-chord percentage and drops the totals for each chord and table, which could be multiplied back into the source counts. Each corpus's song total stays, as a description of its size.
- **Why:** the percentages are measured facts about the corpora and contain none of their annotations. The sources' terms: McGill Billboard, CC0; the iRb corpus, CC BY 4.0; the Hooktheory dataset released with Sheet Sage, CC BY-NC-SA 3.0. All three are credited in the README, and the app is free.
- **Checked:** every percentage is identical to the previous file, and a test fails if a total comes back.
