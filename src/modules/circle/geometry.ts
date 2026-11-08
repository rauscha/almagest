/** Geometry and touch reporting shared by every circle in this folder. Only the drawing differs between them. */
import type { ChordRef, Ring, Send } from "../../core/contract";

export const RING: Record<Ring, { i: number; o: number; half: number; c: number }> = {
  dim: { i: 52, o: 90, half: 27, c: 71 },
  min: { i: 90, o: 148, half: 15, c: 118 },
  maj: { i: 148, o: 204, half: 15, c: 176 },
};

export const f = (n: number) => n.toFixed(1);
export const pol = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [r * Math.sin(a), -r * Math.cos(a)];
};
export const xy = (p: [number, number]) => `${f(p[0])} ${f(p[1])}`;

export function cellPath({ ring, col }: ChordRef): string {
  const R = RING[ring];
  const th = col * 30;
  return (
    `M${xy(pol(R.i, th - R.half))}A${R.i} ${R.i} 0 0 1 ${xy(pol(R.i, th + R.half))}` +
    `L${xy(pol(R.o, th + R.half))}A${R.o} ${R.o} 0 0 0 ${xy(pol(R.o, th - R.half))}Z`
  );
}

/**
 * How far inside a cell, in the circle's units, a moving finger must be before it counts as on that cell
 * rather than the one it came from: about a millimeter on a phone, so the line between two can't flicker.
 */
export const STICK = 6;

/** Whether a polar point lies at least `margin` inside a chord's cell. */
export function inside({ ring, col }: ChordRef, r: number, theta: number, margin: number): boolean {
  const R = RING[ring];
  const off = Math.abs((((theta - col * 30 + 180) % 360) + 360) % 360 - 180);
  return Math.min(r - R.i, R.o - r) >= margin && ((R.half - off) * Math.PI * r) / 180 >= margin;
}

/** Reports touches the same way for every circle, so each one gets every gesture for nothing. */
export function touches(send: Send, svg: () => SVGSVGElement | undefined) {
  function polar(e: PointerEvent) {
    const m = svg()?.getScreenCTM?.();
    if (!m) return { r: 0, theta: 0, ring: "maj" as Ring };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const r = Math.hypot(p.x, p.y);
    const ring: Ring = r < RING.min.i ? "dim" : r < RING.maj.i ? "min" : "maj";
    return { r, theta: (Math.atan2(p.x, -p.y) * 180) / Math.PI, ring };
  }
  const refOf = (el: Element | null | undefined): ChordRef | null => {
    const cell = el?.closest?.("[data-ring]");
    return cell ? { ring: cell.getAttribute("data-ring") as Ring, col: Number(cell.getAttribute("data-col")) } : null;
  };
  /** The chord each finger that went down on one is on now. Only those fingers are followed. */
  const on = new Map<number, ChordRef | null>();
  function under(e: PointerEvent, at: { r: number; theta: number }): ChordRef | null {
    if (!on.has(e.pointerId)) return null;
    // A touch is captured by the cell it went down on, so the event's target can't say where it is now.
    const found = refOf(document.elementFromPoint(e.clientX, e.clientY));
    const last = on.get(e.pointerId) ?? null;
    const same = found && last && found.ring === last.ring && found.col === last.col;
    const now = !found || !last || same || inside(found, at.r, at.theta, STICK) ? found : last;
    on.set(e.pointerId, now);
    return now;
  }
  return {
    down(e: PointerEvent) {
      const target = e.target as Element;
      if (target.closest?.("[data-head]")) {
        send({ type: "touch", phase: "down", pointer: e.pointerId, ref: null, head: true, ...polar(e), time: e.timeStamp });
        return;
      }
      const ref = refOf(target);
      if (!ref) return;
      on.set(e.pointerId, ref);
      send({ type: "touch", phase: "down", pointer: e.pointerId, ref, ...polar(e), time: e.timeStamp });
    },
    report: (phase: "move" | "up" | "cancel") => (e: PointerEvent) => {
      const at = polar(e);
      const ref = phase === "move" ? under(e, at) : null;
      if (phase !== "move") on.delete(e.pointerId);
      send({ type: "touch", phase, pointer: e.pointerId, ref, ...at, time: e.timeStamp });
    },
  };
}
