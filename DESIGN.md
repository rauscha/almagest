---
name: Almagest
description: A circle-of-fifths chord instrument read as a night sky chart, that shows why harmony moves while you play it.
colors:
  night: "#0A0F1D"
  chart: "#172038"
  chart-low: "#121A2E"
  dial: "#141B2F"
  rule: "#2A3450"
  rule-bright: "#3B4663"
  faint: "#5C6782"
  fog: "#8C95AB"
  dim-chalk: "#B9BDC7"
  chalk: "#EFECE3"
  lamp: "#E3B985"
  constellation: "#6F7A95"
typography:
  display:
    fontFamily: "Newsreader, Noto Music, serif"
    fontSize: "64px"
    fontWeight: 300
    lineHeight: 0.95
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Newsreader, Noto Music, serif"
    fontSize: "34px"
    fontWeight: 300
  title:
    fontFamily: "Newsreader, Noto Music, serif"
    fontSize: "25px"
    fontWeight: 400
    lineHeight: 1
  body:
    fontFamily: "Newsreader, Noto Music, serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "IBM Plex Mono, Noto Music, monospace"
    fontSize: "9px"
    fontWeight: 500
    letterSpacing: "0.14em"
  figure:
    fontFamily: "IBM Plex Mono, Noto Music, monospace"
    fontSize: "11px"
    fontWeight: 400
rounded:
  none: "0px"
  pill: "999px"
spacing:
  xs: "2px"
  sm: "4px"
  md: "8px"
  lg: "14px"
  gutter: "24px"
components:
  pad:
    backgroundColor: "{colors.chart-low}"
    textColor: "{colors.chalk}"
    typography: "{typography.title}"
  pad-out:
    backgroundColor: "{colors.night}"
    textColor: "{colors.chalk}"
  pad-held:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.night}"
  choice:
    textColor: "{colors.chalk}"
    typography: "{typography.body}"
    height: "24px"
  choice-on:
    backgroundColor: "{colors.chalk}"
    textColor: "{colors.night}"
  caption:
    textColor: "{colors.lamp}"
    typography: "{typography.label}"
---

# Design System: Almagest

## Overview

**Creative North Star: "The Lit Panel, read as a Living Score"**, worn as **a night sky chart**.

The instrument half: a dark panel where light means information. The teaching half: the circle, the voices and the trail read together like notation that moves. The key is a lit region of sky, chords are named stars, the chords likely to come next are brighter stars, and what was just played is a constellation to trace back.

Calm and precise, also warm and musical. Nothing bounces, nothing glows all at once, and the theory words stay large: they are the subject. Controls are quietly tactile: a touch answers at once, by inversion or a ring.

**Key Characteristics:**
- A deep night ground, chalk-white type and points, three steps of dimmer chalk for hierarchy.
- A light serif (Newsreader) for every musical word, italic for chord names, upright for numerals; a mono only for figures and captions.
- One meaning per mark: size is likelihood, a ring is engaged, line style is function, shading is the key.
- Shared hairline dividers everywhere, never boxes with gaps.
- A warm lamp tint on captions only, never on a state.

## Colors

A night chart: near-black ground, chalk ink, hairlines in two steps, and one warm lamp tint for captions.

### Primary
- **Chalk** (#EFECE3): live text, the sounding chord's ring, the ranked stars, a held pad's fill.

### Secondary
- **Lamp** (#E3B985): captions (VOICING, NEXT, ON G7) and the word "out" on a pad. It names; it never marks a state.

### Neutral
- **Night** (#0A0F1D): the ground.
- **Chart** (#172038) and **Chart low** (#121A2E): the lit key region, misted toward the hub; chart low also shades a pad that keeps you in the key, and the accidental rows of the voices.
- **Dial** (#141B2F): the hub and the keyboard's natural keys.
- **Rule** (#2A3450) and **Rule bright** (#3B4663): dividers, rings, the key's outline, frames.
- **Faint** (#5C6782): unlit marks only, never text.
- **Fog** (#8C95AB): captions in mono, out-of-key chord names, held tones, at least 4.5:1 on night.
- **Dim chalk** (#B9BDC7): secondary names, a trail star, chord names under pads.
- **Constellation** (#6F7A95): the ghostly steps still to come of a loaded progression. The trail itself is chalk, fading by opacity.

### Named Rules
**The Grayscale Test.** Desaturate the screen: every state must still read, in the key or out, sounding, ranked, latched, held, unavailable.

**The One Meaning Rule.** Size and brightness of a star mean likelihood, as magnitude does on a sky chart; a ring means engaged, line style means function, shading means the key. A mark never borrows another's meaning (why every note point in the voices is the same size).

**The Lamp Names Rule.** The warm tint is for captions and the word "out". If removing it would lose a state, the design is wrong.

## Typography

**Display and body:** Newsreader (with Noto Music for ♭ ♯ 𝄪), self-hosted.
**Figures and captions:** IBM Plex Mono (with Noto Music), self-hosted.

**Character:** a light optical serif makes the chord names and numerals read like a score's, and the italics give the names a hand; the mono keeps numbers and captions measured. Accidentals come from the music font and are set small and raised, as engraved.

### Hierarchy
- **Display** (300 italic, 64px, line-height 0.95): the sounding chord in the readout; its quality set at 40px.
- **Headline** (300 italic, 34px): the key on the hub dial.
- **Title** (400, 25px; 17px for words like Major): pad labels.
- **Numerals on the circle** (400, 23px major, 18px minor, 13px diminished; 500 while sounding), chord names beneath in italic at 11.5, 10.5 and 9.5px.
- **Body** (400, 13px): Menu choices; sound names in italic at 12px.
- **Label** (500, 9px, 0.14em, uppercase, lamp): captions.
- **Figure** (400, 9 to 12px mono): odds, semitones, note names, octave labels.

### Named Rules
**The No-Wrap Rule.** No label breaks onto a second line, and no label moves when something appears beside it (`tools/verify/layout.cjs`).

## Layout

A fixed 998 × 448 stage scaled to the landscape phone, in three columns that follow the thumbs:
- **Left (x 24 to 240):** a small Menu, the voicing slider, the next-chord table, and the pads below.
- **Middle (x 262 to 520):** the readout, then the voices beside a keyboard, with the trail beneath.
- **Right (x 534 to 974):** the circle, 440px, with legends in its corners.

The Menu opens over the middle column, so the pads and circle stay playable. Rhythm: 4px inside groups, 8 to 14px between groups, 24px to the screen edge.

## Elevation & Depth

Flat. No shadows. Depth is luminance: chalk forward, dim and fog behind, and a radial mist from chart low at the hub to chart at the rim, so the key region reads as lit sky.

## Shapes

True circles and straight hairlines. No corner radius on frames; a pill (999px) only for the ring that marks an engaged pad. The circle is one shape divided by shared lines; the pads, the choice rows and the sound list are frames divided the same way.

## Components

### The circle (signature)
Twelve columns of major, minor and diminished chords in three rings, divided by hairlines. The key's seven chords form a lit wedge with a brighter outline. Each in-key cell carries its numeral over its italic name, and a function arc inside its outer edge (solid home, dashed away, dotted tension; iii half solid, half dotted). Out-of-key chords show their names only, in fog. The sounding chord wears a chalk ring. Every chord the counts say might come next carries a star left of its numeral, brighter and larger for a stronger connection, on one absolute scale shown in the corner (60, 30, 10, 3%); earlier trail chords carry a small dim star, and a thin constellation line joins the trail beneath everything, fading as it ages: the newest move in chalk, each older one 0.6 as bright at the same width, so it goes ghostly within a few moves. A progression loaded from the Menu is drawn as a constellation still to trace: each step's chord ringed and numbered, joined by straight lines; the next move is lit (its line in chalk with an arrowhead, its chord's ring in chalk) and the moves after it are ghostly in the constellation tone, the reverse of the trail fading behind. Steps played leave the figure and become the trail; while a progression is loaded, the trail shows only those steps, dimmed, so nothing outshines the move to come. Its numerals, name and key sit in the chart's open top-left corner, with NEXT and the next numeral in lamp caps, and "× put away". Drawn with its 7ths (the Menu's default), the corner writes each step's 7th or add9 raised and small, as a jazz chart does (ii⁷–V⁷–I^maj7), NEXT names the whole chord, and the lit next chord on the circle is named as it would play (Cmaj7); a press on it plays exactly that, unless a latched 7th or 9th pad wins. While a pad is held, every cell is named as a press would give it. After a long press, the chord that leads to the one held (its secondary dominant) wears a dotted chalk ring, LEADS HERE in lamp caps above it, and its name as the 7th it plays; the dotted line is tension, as in the function arcs. The hub is the key dial: graduated, with a pointer at the key's column, "KEY", the key in italic and its mode, and the word "drag".

### Readout
The sounding chord at display size, its numeral beside it, then the function's own mark and plain word with the term in mono ("Tension (dominant)"), and a quiet "Moved N semitones". At rest it shows the key; after the sound ends it keeps the last chord, a step dimmer. If the sound stops while the app is in view, a pill says "sound stopped · touch a chord to wake it". When the trail ends in a named progression, its numerals sit beside the chord's numeral at 24px with its name in lamp caps beneath (CIRCLE PROGRESSION) and, when it isn't in the home key, where it is in mono ("in D minor"). Short of room it steps down: numerals alone, then numerals at the end of the function row, then nothing, leaving the trail's bracket to name it.

### Voices
A vertical keyboard, one row per semitone, accidental rows shaded across the roll, C rows ruled and labeled, the keys of sounding notes lit. Each voice is a line: a held tone continues without a new point, a change slants in and starts a point. All points the same size; the sounding chord's points wear rings, and its lines fade toward the right with the release. The window of pitches widens and narrows without jitter, never under 28 rows. At the right, the sounding notes are named; a note a pad added carries its figure after the name in chalk, 7 or 9, as the leading tone carries LT. Two notes a semitone apart spread their names evenly so they never overlap. Beneath: the trail's names and numerals; crowded, older chords keep only their numerals. Under them, a ruled line with a tick per chord, or, once the trail holds a named progression, brackets in its place, as analysis marks on a jazz chart: each spans its chords with a short name in mono caps beneath (AXIS, CIRCLE), the one the chord now completes in chalk with its name in lamp, older ones in fog. Two that share a chord meet under it.

### Left column
A small framed Menu control; the voicing slider (three dots packed at Close, spread at Wide, the chosen stop ringed); the next-chord table, each row led by the same star as on the circle, name, numeral, odds (with `~` for estimates) and the semitones the voices would move.

### Pads
Three by three in one frame: 7, maj7, 9 / add9, sus2, sus4 / Major, Minor, Sustain. Shaded ground means the chord would stay in the key; unshaded ground and the word "out" mean it leaves. A ring means latched or applied; a pad under the finger fills chalk. Labels never move; the chord each would give sits beneath.

### Menu
Engines and sounds in ruled frames, then Next chords, Shape (Off, ii–V–I, Circle, Axis, Andalusian, each button as wide as its name), Shape chords (Plain, or With 7ths and add9s), moving voices with slide times in one row, then space and ring sharing one line and the actions Clear trail and Done. A status line at the foot.

## Do's and Don'ts

### Do:
- **Do** pass the grayscale test on every state.
- **Do** give every mark one meaning, and draw the legend beside what it explains.
- **Do** set musical words in the serif and figures in the mono.
- **Do** divide groups with shared hairlines in one frame.
- **Do** keep the theory words large; they are what's being learned.

### Don't:
- **Don't** let the lamp tint, or any hue, carry a state.
- **Don't** use size for anything but likelihood.
- **Don't** use line style for anything but function.
- **Don't** add shadows, glows, bounce, or gaps between controls.
- **Don't** draw lines across the circle for suggestions; stars and the trail are enough.
