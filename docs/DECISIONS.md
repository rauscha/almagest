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

## D3: A tap takes off the color a shape added
- **Date:** 2026-11-08.
- **What:** on a chord that took its 7th or add9 from the loaded shape, tapping that pad now turns the color off for that step of the shape, and a second tap restores it. The step's name in the corner and on the circle follows. Choosing a shape, or switching Shape chords, starts over.
- **Why:** playing the Axis, the I couldn't be played without its add9. A tap went through the latch, so it took the add9 off the sounding chord and turned it on for every chord after.
- **Checked:** a unit test written to fail first, the type check, `tools/verify/layout.cjs`, `tools/verify/drive_app.cjs`, and a screenshot of the Axis after the tap.

## D4: Recorded piano and strings, and fewer wave sounds
- **Date:** 2026-11-08.
- **What:** a third group, Recorded, holds Grand Piano and Orchestral Strings. Wave Terrain and Waveshaper are gone from Multi-model.
- **Why:** the oscillator engines can't make an acoustic piano, so these are real recordings played by Almagest's own small engine. The piano never slides: a voice that moves strikes its new note, a shared note keeps ringing, and a released note keeps ringing and fading for many seconds, as with a held pedal. Close-miked notes die quickly, so `tools/samples/build.py` keeps each strike and raises what follows. The strings can slide, as a player shifts along the string. Wave Terrain and Waveshaper sounded too much like Wavetable and were the two least clear on chords in the survey.
- **Sources:** Salamander Grand Piano V3 (CC BY 3.0) and the VSCO 2 Community Edition violin and cello sections (CC0). The string sources are about 2 s long, so their loops are short.
- **Checked:** unit tests (a file for every note, the nearest recording at the right pitch, a saved sound moved to the shorter list), `tools/verify/layout.cjs`, `tools/verify/drive_app.cjs` across every sound, a browser run counting strikes on a chord change, and a listen on the phone: the piano is a keeper, and the strings are good enough to stay.
- **Settings:** the key is now v5, carrying v4's settings over.

## D5: Serif numbers, a cleaner shape corner, more progressions
- **Date:** 2026-11-08.
- **Numbers:** chosen from mockups. Figures, chord names on the pads and small captions are set in the serif, with lining numerals. The mono is kept for the small spaced capitals.
- **Shape corner:** chosen from mockups. The SHAPE and NEXT lines are gone: the numerals title themselves, and the lit arrow and chord name on the circle say what's next. "Put away" no longer runs into the rim.
- **Sounds:** Virtual Analog and 6-Op FM Bank A dropped, leaving five multi-model sounds in three rows. The settings key is v6, moving a saved choice from either earlier list to the nearest sound that remains.
- **Progressions:** a second Menu row adds Doo-wop, Canon, Blues, Ragtime and Rock. A chord a progression comes back to gets one ring carrying each step's number, and tapping off its 7th applies wherever it comes up. The Blues stops at IV7, so it loops into the next chorus's I7 instead of waiting on the chord already sounding.
- **Checked:** unit tests (each progression's numerals, placement in other keys and step-following through repeated chords), the type check, `tools/verify/layout.cjs`, `tools/verify/drive_app.cjs`, and screenshots of the Canon, Blues and Ragtime with the Menu open and closed.

## D6: 7 in key, and Sustain under the right thumb
- **Date:** 2026-11-08.
- **What:** a pad, 7 in key, gives every chord its own 7th while playing freely, and the circle names each chord as it would play. Chords outside the key take a 7th too: dominant on major chords, m7 on minor ones. It takes Sustain's cell, so the pads stay three by three. Sustain becomes a round button in the circle's lower right corner, and the function legend moves to the lower left. Both were chosen from mockups.
- **Order:** a tapped 7th or 9th pad replaces the mode's 7th and lifts back to it. The mode wins over a loaded shape's color. The pads stay unringed for a 7th the mode added, since a ring says that pad is doing it.
- **Checked:** unit tests (the seven chords in major and relative minor, outside the key, other keys, the pad order, a shape loaded, a sus pad, the saved setting), the type check, `tools/verify/layout.cjs`, `tools/verify/drive_app.cjs`, and screenshots with the mode on and off.
