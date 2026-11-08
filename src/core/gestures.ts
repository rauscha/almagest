/**
 * What touches mean, per docs/GESTURES.md. The timed gestures join here, so a rebuilt circle gets them
 * without doing anything.
 */
import type { ChordRef, Mode, Ring, Touch } from "./contract";

export type Gesture =
  | { kind: "pressed"; ref: ChordRef; pointer: number; r: number; theta: number }
  | { kind: "released"; pointer: number }
  | { kind: "canceled"; pointer: number }
  | { kind: "headGrabbed"; pointer: number; r: number; theta: number; fromHub: boolean }
  | { kind: "moved"; pointer: number; r: number; theta: number; ring: Ring; ref: ChordRef | null };

export function readTouch(touch: Touch): Gesture | null {
  switch (touch.phase) {
    case "down":
      // The rim head lies outside every chord; the hub lies inside them all.
      if (touch.head) return { kind: "headGrabbed", pointer: touch.pointer, r: touch.r, theta: touch.theta, fromHub: touch.ring === "dim" };
      return touch.ref ? { kind: "pressed", ref: touch.ref, pointer: touch.pointer, r: touch.r, theta: touch.theta } : null;
    case "up":
      return { kind: "released", pointer: touch.pointer };
    case "cancel":
      return { kind: "canceled", pointer: touch.pointer };
    default:
      return { kind: "moved", pointer: touch.pointer, r: touch.r, theta: touch.theta, ring: touch.ring ?? "maj", ref: touch.ref };
  }
}

/** docs/GESTURES.md: holding this long fans out the arrows. A quick tap never gets there. */
export const HOLD_MS = 180;
/** docs/GESTURES.md: holding this long also lights the chord that leads to the one held. */
export const LONG_MS = 450;

const mod = (n: number, m: number) => ((n % m) + m) % m;
const DEGREES = 30;
/** How far past the halfway line the finger must go before the key changes, so it can't flicker there. */
const STICK = 4;
/** docs/GESTURES.md's movement threshold: less than this is a shaky finger, not a drag. */
export const DRAG_START = 12;

/** The straight-line distance between two polar points. */
export const moved = (r0: number, th0: number, r1: number, th1: number) =>
  Math.sqrt(Math.max(0, r0 * r0 + r1 * r1 - 2 * r0 * r1 * Math.cos(((th1 - th0) * Math.PI) / 180)));

/** The column the finger has dragged the head to, staying on the current one near the line between two. */
export function columnAt(current: number, theta: number): number {
  const off = mod(theta - current * DEGREES + 180, 360) - 180;
  return Math.abs(off) <= DEGREES / 2 + STICK ? current : mod(Math.round(theta / DEGREES), 12);
}

/** How far in the finger is picks the mode: the outer ring is major, anywhere further in is minor. */
export const modeAt = (ring: Ring): Mode => (ring === "maj" ? "major" : "minor");

/** docs/GESTURES.md: a swipe is judged once the finger has moved this far from where it landed. */
export const SWIPE_COMMIT = 24;
/** How far off straight in or out a swipe may head, in degrees, so a sloppy one never reaches the chord next door. */
export const SWIPE_CONE = 35;

/**
 * Which way a move from one polar point to another headed, relative to the line through the circle's
 * center: "in", "out", or null when it's more sideways than the cone allows.
 */
export function radialHeading(r0: number, th0: number, r1: number, th1: number): "in" | "out" | null {
  const a0 = (th0 * Math.PI) / 180, a1 = (th1 * Math.PI) / 180;
  const vx = r1 * Math.sin(a1) - r0 * Math.sin(a0);
  const vy = -r1 * Math.cos(a1) + r0 * Math.cos(a0);
  const len = Math.hypot(vx, vy);
  if (len === 0 || r0 === 0) return null;
  // The outward direction at the landing point.
  const cos = (vx * Math.sin(a0) - vy * Math.cos(a0)) / len;
  const limit = Math.cos((SWIPE_CONE * Math.PI) / 180);
  return cos >= limit ? "out" : cos <= -limit ? "in" : null;
}

/**
 * Where a swipe goes (docs/GESTURES.md): in on a major chord is its relative minor, the cell inside it;
 * out on a minor is its relative major. The other two directions, and the diminished cell, are kept free.
 */
export function swipeTarget(ref: ChordRef, heading: "in" | "out" | null): ChordRef | null {
  if (ref.ring === "maj" && heading === "in") return { ring: "min", col: ref.col };
  if (ref.ring === "min" && heading === "out") return { ring: "maj", col: ref.col };
  return null;
}
