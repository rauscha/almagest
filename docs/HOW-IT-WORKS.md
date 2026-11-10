# How it works

The music theory behind the screen. All of it lives in `src/theory/`, as pure functions with tests. Getting the music right is the main risk in a teaching instrument, so this is the most heavily tested part of the code.

## The circle and the key

The circle has twelve columns, one per step around the circle of fifths, and three rings: major chords outside, their relative minors inside them, and the diminished chords innermost. Choosing a key lights a wedge of seven chords, its diatonic set. In C major that's C, Dm, Em, F, G, Am and B°.

Each chord in the key gets a Roman numeral, in the jazz and classical convention: uppercase for major, lowercase for minor, ° for diminished, and suffixes like V7 and IVmaj7. Never Nashville numbers. Each also gets a function, drawn as a line style rather than a color: solid for home (tonic), dashed for away (subdominant) and dotted for tension (dominant). iii shares home and tension, so it's half solid and half dotted.

In a minor key, the wedge shows the natural v. The Major pad turns it into the raised V, and the leading tone is marked in the voices. A chord outside the key is named by its numeral relative to the key: ♭VII, borrowed iv, II.

## Spelling

`spell.ts` names notes by their place on the line of fifths, where C is 0, G is 1 and F is −1. Each key takes a run of positions, so a note is spelled the way the key needs it: F♯ as V of B, never G♭. A leading tone is never spelled flat. Double flats, double sharps, C♭, F♭, E♯ and B♯ are never shown: a chord there takes the plain name (B, not C♭, in F minor) and its numeral follows (♯IV). The tests check the spellings against [Tonal](https://github.com/tonaljs/tonal).

## Next chords

When you hold a chord, the chords that most often follow it light up as stars, brighter and larger for more likely, as magnitude works on a sky chart. One absolute scale (60, 30, 10 and 3 percent) is drawn in the corner, so a star means the same thing on every chord. The table on the left gives the exact odds.

The odds are counted from real music by `tools/corpus/transitions.py`, from three published corpora:

| Collection | Source | Songs |
|---|---|---|
| Modern pop (default) | Hooktheory TheoryTab annotations (Donahue, Thickstun and Liang, 2022) | 15,213 |
| Classic pop | The McGill Billboard Project, chart songs 1958 to 1991 (Burgoyne, Wild and Fujinaga, 2011) | 739 |
| Jazz | The iRb corpus of jazz standards (Broze and Shanahan, 2013) | 1,185 |

The method stays close to how the app names chords:

- Every chord becomes a numeral relative to the key in force: a major, minor or diminished triad on a root. Extensions fold into the triad, so G7 and Gmaj7 both count as V. Sus, power, augmented and unclear chords break the chain rather than guess.
- Repeats collapse, so a transition is always to a different chord.
- A song that appears more than once counts once.
- A row is kept only when at least 20 transitions leave that chord, and a target only when it follows at least 2 percent of the time, so every number shown was measured.

Only the resulting percentages are in the repository (`src/theory/corpus.json`), never the songs or the counts behind them. Adding a genre means counting another corpus into that file.

## Voicing

`voicing.ts` decides which notes each voice plays. There are five voices: a bass and four above it. For each new chord it lists the ways the chord's notes could sit across the voices, then picks the one that moves least from the chord before. That's what makes a progression smooth, and it's also what produces the exact motion the voices panel draws.

- The bass takes the root and stays below everything, so voices never cross.
- When a chord has more notes than there are upper voices, the notes least worth keeping go first. The 5th goes before the 3rd or an added 7th.
- The upper voices are kept within a band, which pulls a progression back toward the middle when it keeps drifting one way.
- The voicing slider spreads the upper voices: close, open or wide.

A note shared by two chords stays in its voice and keeps sounding, with no new attack. That's what "held" means in the voices panel.

## Pads

The pads add a 7, maj7, 9 or add9, suspend the chord (sus2, sus4), or switch its quality (Major, Minor). A tapped pad stays on for every chord after, until it's tapped off, Major and Minor included. Holding a pad applies it to each chord pressed while it's held. Under each pad is the chord it would give, and a pad whose result leaves the key says "out".

## Progressions

`shapes.ts` holds the named progressions: ii–V–I, the circle progression (vi–ii–V–I), the axis progression (I–V–vi–IV), the Andalusian cadence (i–♭VII–♭VI–V), the doo-wop changes (I–vi–IV–V), Pachelbel's Canon (I–V–vi–iii–IV–I–IV–V), the twelve-bar blues (I–IV–I–V–IV), the ragtime progression (III–VI–II–V–I) and the rock vamp (I–♭VII–IV).

- **Recognized.** A progression is matched by root motion and chord quality, measured from its own tonic, so it's found in any key. When you play one, the readout names it, and if it isn't in the home key, says where it is ("in D minor").
- **Loaded.** Pick one in the Menu and it's drawn on the circle as a constellation still to trace, with the next move lit. Steps you play leave the figure and become the trail.
- **With its 7ths.** Each progression carries the color it's usually played with: ii7–V7–Imaj7, vi7–ii7–V7–Imaj7, Iadd9–V–vi7–IVmaj7, I7–IV7–I7–V7–IV7, E7–A7–D7–G7–C in C, and V7 to end the Andalusian and the doo-wop changes. Pressing the next step plays it that way without touching a pad. A pad you've tapped or are holding wins. A Menu setting turns this off.

## Secondary dominants

A long press on a chord also lights the chord that leads to it: its secondary dominant, a fifth above. For Am that's E. It's marked "leads here" with a dotted ring, since dotted means tension, and sliding onto it plays it as a 7th: E7 to Am.
