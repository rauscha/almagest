import { describe, expect, it } from "vitest";
import { findShapes, placeShape, stepsPlayed, type ShapeChord } from "./shapes";
import type { Key } from "./spell";

const C_MAJOR: Key = { col: 0, mode: "major" };
const A_MINOR: Key = { col: 0, mode: "minor" };
const PC: Record<string, number> = { C: 0, "C♯": 1, D: 2, "E♭": 3, E: 4, F: 5, "F♯": 6, G: 7, "A♭": 8, A: 9, "B♭": 10, B: 11 };

/** "Dm" → D minor, "B°" → B diminished, "G" → G major. */
const chords = (...names: string[]): ShapeChord[] =>
  names.map((n) => {
    const m = n.match(/^([A-G][♭♯]?)(m|°)?$/)!;
    return { root: PC[m[1]], ring: m[2] === "m" ? "min" : m[2] === "°" ? "dim" : "maj", rootName: m[1] };
  });
const brief = (found: ReturnType<typeof findShapes>) => found.map((f) => `${f.numerals}@${f.from}-${f.to}${f.where ? ` in ${f.where}` : ""}`);

describe("named shapes", () => {
  it("Dm, G, C names ii–V–I; Am, Dm, G, C names the longer progression", () => {
    expect(brief(findShapes(chords("Dm", "G", "C"), C_MAJOR))).toEqual(["ii–V–I@0-2"]);
    const longer = findShapes(chords("Am", "Dm", "G", "C"), C_MAJOR);
    expect(brief(longer)).toEqual(["vi–ii–V–I@0-3"]);
    expect(longer[0].name).toBe("circle progression");
  });

  it("names the axis and the Andalusian descent", () => {
    expect(findShapes(chords("C", "G", "Am", "F"), C_MAJOR).map((f) => f.id)).toEqual(["axis"]);
    const desc = findShapes(chords("Am", "G", "F", "E"), A_MINOR);
    expect(brief(desc)).toEqual(["i–♭VII–♭VI–V@0-3"]);
  });

  it("finds every shape in the trail, oldest first, sharing at most one chord", () => {
    expect(brief(findShapes(chords("C", "G", "Am", "F", "Am", "Dm", "G", "C"), C_MAJOR))).toEqual(["I–V–vi–IV@0-3", "vi–ii–V–I@4-7"]);
    expect(brief(findShapes(chords("Am", "Dm", "G", "C", "G", "Am", "F"), C_MAJOR))).toEqual(["vi–ii–V–I@0-3", "I–V–vi–IV@3-6"]);
    expect(brief(findShapes(chords("Dm", "G", "C", "F", "C", "G", "Am", "F"), C_MAJOR))).toEqual(["ii–V–I@0-2", "I–V–vi–IV@4-7"]);
  });

  it("names nothing when the trail holds no shape", () => {
    expect(findShapes(chords("C", "F", "C", "G"), C_MAJOR)).toEqual([]);
    expect(findShapes(chords("G", "Dm", "C"), C_MAJOR)).toEqual([]); // the right chords in the wrong order
    expect(findShapes([], C_MAJOR)).toEqual([]);
  });

  it("finds a shape in any key, and says where it is when that isn't home", () => {
    // Moving the key moves nothing about the shape: it's the same rotated.
    expect(brief(findShapes(chords("Am", "D", "G"), { col: 1, mode: "major" }))).toEqual(["ii–V–I@0-2"]);
    expect(brief(findShapes(chords("Am", "D", "G"), C_MAJOR))).toEqual(["ii–V–I@0-2 in G major"]);
    // Aimed at a minor chord, the numerals say so.
    expect(brief(findShapes(chords("Em", "A", "Dm"), C_MAJOR))).toEqual(["ii–V–i@0-2 in D minor"]);
    expect(brief(findShapes(chords("E°", "A", "Dm"), C_MAJOR))).toEqual(["ii°–V–i@0-2 in D minor"]);
    // The descent in A minor, played in C major, is in A minor.
    expect(brief(findShapes(chords("Am", "G", "F", "E"), C_MAJOR))).toEqual(["i–♭VII–♭VI–V@0-3 in A minor"]);
  });

  it("counts a chord repeated (C, then C7 from a pad) as one step, spanning both", () => {
    expect(brief(findShapes(chords("Dm", "G", "G", "C"), C_MAJOR))).toEqual(["ii–V–I@0-3"]);
  });

  it("sets a library shape in any key: same shape, rotated", () => {
    const where = (id: string, key: Key) => placeShape(id, key)!.steps.map((s) => `${s.root}${s.ring === "min" ? "m" : ""}`).join(" ");
    expect(where("circle", C_MAJOR)).toBe("9m 2m 7 0"); // Am Dm G C
    expect(where("circle", { col: 3, mode: "major" })).toBe("6m 11m 4 9"); // F♯m Bm E A
    // In a minor key a major-aimed shape goes to the relative major, and a minor-aimed one stays home.
    expect(where("circle", A_MINOR)).toBe("9m 2m 7 0");
    expect(where("andalusian", A_MINOR)).toBe("9m 7 5 4"); // Am G F E
    expect(where("andalusian", C_MAJOR)).toBe("9m 7 5 4");
    expect(placeShape("andalusian", C_MAJOR)!.tonic).toEqual({ root: 9, ring: "min" });
    expect(placeShape("two-five-one", C_MAJOR)!.steps.map((s) => s.numeral)).toEqual(["ii", "V", "I"]);
    expect(placeShape("nope", C_MAJOR)).toBeNull();
  });

  it("counts how far into a loaded shape the trail has just come", () => {
    const circle = placeShape("circle", C_MAJOR)!;
    expect(stepsPlayed(circle, [])).toBe(0);
    expect(stepsPlayed(circle, chords("C", "Am"))).toBe(1);
    expect(stepsPlayed(circle, chords("C", "Am", "Dm"))).toBe(2);
    expect(stepsPlayed(circle, chords("Am", "Dm", "Dm", "G"))).toBe(3); // a repeat is one step
    expect(stepsPlayed(circle, chords("Am", "Dm", "F"))).toBe(0); // off the path
    expect(stepsPlayed(circle, chords("Am", "Dm", "G", "C"))).toBe(0); // finished: start again
    expect(stepsPlayed(circle, chords("Am", "Dm", "G", "C", "Am"))).toBe(1);
    // Only where it's drawn: Am Dm in G major is a different place on the circle.
    expect(stepsPlayed(placeShape("circle", { col: 1, mode: "major" })!, chords("Am", "Dm"))).toBe(0);
    // The 7th from a pad keeps the quality, so Dm7 counts as Dm (the core passes ring by quality).
    const ii = placeShape("two-five-one", C_MAJOR)!;
    expect(stepsPlayed(ii, chords("Dm", "G"))).toBe(2);
  });

  it("needs the qualities as well as the roots", () => {
    expect(findShapes(chords("D", "G", "C"), C_MAJOR)).toEqual([]); // II–V–I is a chain of dominants, not this shape
    expect(findShapes(chords("Dm", "Gm", "C"), C_MAJOR)).toEqual([]);
  });
});
