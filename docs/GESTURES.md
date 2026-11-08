# Gestures

**The rule that keeps them apart:** a finger going down on a chord sounds it at once. Every other gesture is decided afterward, from what that finger does next, so no gesture ever delays the first sound.

The timings live in `src/core/gestures.ts`, a pure state machine in the core. A circle module only reports where each touch is and when, so a rebuilt circle gets every gesture for free.

## The gestures

| Gesture | Where | What it does |
|---|---|---|
| **Press** | A chord | Plays it. The readout, voices and keys update. |
| **Hold**, 180 ms | A chord | The chords likely to come next light up as stars, with the odds in the table. |
| **Slide onto a star** | While holding | Plays that chord, with shared notes held. Letting go there keeps it, and sliding back returns. Only the pressed chord's stars respond, so wandering across the circle plays nothing by accident. |
| **Long press**, 450 ms | A chord | Also lights its secondary dominant, a fifth above, marked "leads here". Sliding onto it plays it as a 7th. |
| **Swipe in** | A major chord | Its relative minor. |
| **Swipe out** | A minor chord | Its relative major. |
| **Drag from the hub** | The center of the circle | The key dial. Drag onto any chord and it becomes the key: onto Em for E minor, onto G for G major. Nothing changes while the finger stays in the middle. |
| **Tap a pad** | The pads | Turns it on for this chord and every chord after, until it's tapped off. |
| **Tap the pad a shape added** | The pads, on a chord of a loaded shape | Takes that 7th or add9 off this step of the shape, and every other chord stays as it was. A second tap puts it back. Choosing the shape again starts it over. |
| **Tap 7 in key** | The pads | Every chord takes its own 7th until it's tapped off: Cmaj7, Dm7, G7 in C. Chords outside the key take one too (E7, Fm7). A 7th or 9th pad you tap replaces it. |
| **Tap Sustain** | The round button under the right thumb | The chord keeps sounding after you lift, until it's tapped off. |
| **Hold a pad, press chords** | The pads | Each chord pressed while it's held takes that pad. Letting go puts the pads back as they were. |

It's one chord at a time: if a second finger presses another chord, the newest wins. The readout and voices panel don't take touches. Pinch, text selection and the long-press menu are turned off.

## How they stay apart

| Could be | How it's decided |
|---|---|
| Tap, hold or long press | Time alone. All three start the same way and sound the same. A quick tap never reaches the 180 ms that lights the stars. |
| Swipe, or slide onto a star | Time. Movement before the stars appear is a swipe; movement after is a slide. A slow drift counts as neither until it passes 12 px, about 2 mm. |
| Swipe, or the chord next door | A swipe commits 24 units from where the finger landed, and only within 35 degrees of straight toward or away from the center. Anything more sideways is ignored, so a sloppy press never lands on its neighbor. |
| Long press, or the stars | They stack: stars at 180 ms, then "leads here" at 450 ms, and both stay. |
| Swipe out on a major, or in on a minor | Nothing happens. These are reserved. |
| Pad and chord at once | They never conflict, since they're under different thumbs. Either order works. |
| Android's back gesture | It owns the screen's left and right edges, and a web app can't reserve them. In practice it doesn't steal swipes on the chords near the right edge. |
| Android takes over a touch | Any canceled touch ends the chord and clears the gesture, so a note can never stick. |

## Not built yet

**Flick across the center**, for a chord's tritone substitute, with the two notes it shares marked on the keys.
