import { describe, expect, it } from "vitest";
import { Chord as TonalChord, Note } from "@tonaljs/tonal";
import { nextChords, PRESETS } from "./transitions";
import corpus from "./corpus.json";
import { mod, noteAt, majorName, minorName, diminishedName, withOctave, type Key } from "./spell";
import { ALTERATIONS, canAlter, canRaise, chordOf, circleChords, DOMINANT_7, fitsKey, PLAIN, secondaryDominant, tonicPc, toggleAlteration, type Alteration, type Alts, type ChordRef } from "./keyLens";

const C: Key = { col: 0, mode: "major" };
const Am: Key = { col: 0, mode: "minor" };
const inKey = (key: Key) => circleChords(key).filter((c) => c.inKey);

describe("line of fifths", () => {
  it("names notes along the line", () => {
    expect([-6, -2, -1, 0, 1, 5, 6, 7].map(noteAt)).toEqual(["G♭", "B♭", "F", "C", "G", "B", "F♯", "C♯"]);
    expect(noteAt(-7)).toBe("C♭");
    expect(noteAt(11)).toBe("E♯");
  });
});

describe("the wedge", () => {
  it("in C major", () => {
    const got = Object.fromEntries(inKey(C).map((c) => [c.name, c.numeral]));
    expect(got).toEqual({ F: "IV", C: "I", G: "V", Dm: "ii", Am: "vi", Em: "iii", "B°": "vii°" });
  });
  it("in A minor, the same seven cells", () => {
    const got = Object.fromEntries(inKey(Am).map((c) => [c.name, c.numeral]));
    expect(got).toEqual({ F: "VI", C: "III", G: "VII", Dm: "iv", Am: "i", Em: "v", "B°": "ii°" });
  });
  it("moves with the key: G major", () => {
    const got = Object.fromEntries(inKey({ col: 1, mode: "major" }).map((c) => [c.name, c.numeral]));
    expect(got).toEqual({ C: "IV", G: "I", D: "V", Am: "ii", Em: "vi", Bm: "iii", "F♯°": "vii°" });
  });
  it("Em carries both functions, and the rest one each", () => {
    const fn = Object.fromEntries(inKey(C).map((c) => [c.name, c.fn]));
    expect(fn).toEqual({
      F: "subdominant", Dm: "subdominant", C: "tonic", Am: "tonic", G: "dominant", "B°": "dominant", Em: "both",
    });
  });
  it("offers one diminished chord, at the key's column", () => {
    for (let col = 0; col < 12; col++) {
      const dims = circleChords({ col, mode: "major" }).filter((c) => c.ref.ring === "dim");
      expect(dims.map((d) => d.ref.col)).toEqual([col]);
    }
  });
});

describe("spelling follows the key", () => {
  it("V of B major is F♯, and IV of G♭ major is C♭", () => {
    expect(majorName(6, { col: 5, mode: "major" })).toBe("F♯");
    expect(majorName(6, C)).toBe("G♭");
    expect(majorName(5, { col: 6, mode: "major" })).toBe("C♭");
  });
  it("every key's seven chords use each letter once", () => {
    for (let col = 0; col < 12; col++) {
      const key: Key = { col, mode: "major" };
      const roots = inKey(key).map((c) => c.name[0]).sort().join("");
      expect(roots, `key column ${col}`).toBe("ABCDEFG");
    }
  });
  it("keeps outside chords readable, with no double accidentals", () => {
    for (let col = 0; col < 12; col++) {
      for (const c of circleChords({ col, mode: "major" })) expect(c.name, c.name).not.toMatch(/♭♭|𝄪|♯♯/);
    }
  });
  it("uses the expected names around C major", () => {
    expect([...Array(12).keys()].map((c) => majorName(c, C))).toEqual(
      ["C", "G", "D", "A", "E", "B", "G♭", "D♭", "A♭", "E♭", "B♭", "F"],
    );
    expect(minorName(0, C)).toBe("Am");
    expect(minorName(6, C)).toBe("E♭m");
    expect(diminishedName(0, C)).toBe("B°");
    expect(diminishedName(6, { col: 6, mode: "major" })).toBe("F°");
  });
});

describe("numerals", () => {
  it("are Roman everywhere: upper major, lower minor, ° diminished", () => {
    for (const key of [C, Am, { col: 3, mode: "minor" } as Key]) {
      for (const c of circleChords(key)) {
        expect(c.numeral, c.name).toMatch(/^[♭♯]?(I{1,3}|IV|VI{0,2}|i{1,3}|iv|vi{0,2})°?$/);
        const letters = c.numeral.replace(/[♭♯°]/g, "");
        if (c.ref.ring === "maj") expect(letters).toBe(letters.toUpperCase());
        else expect(letters).toBe(letters.toLowerCase());
      }
    }
  });
  it("names outside chords by distance from the tonic", () => {
    const num = (ref: ChordRef) => chordOf(ref, C).numeral;
    expect(num({ ring: "maj", col: 7 })).toBe("♭II"); // D♭
    expect(num({ ring: "maj", col: 10 })).toBe("♭VII"); // B♭
    expect(num({ ring: "min", col: 9 })).toBe("i"); // Cm, the parallel minor
  });
});

describe("chord tones agree with an independent source", () => {
  it("in every key, as named", () => {
    for (let col = 0; col < 12; col++) {
      for (const mode of ["major", "minor"] as const) {
        for (const c of circleChords({ col, mode })) {
          const symbol = c.name.replace("♯", "#").replace("♭", "b").replace("°", "dim");
          const tonal = TonalChord.get(symbol);
          expect(tonal.empty, symbol).toBe(false);
          const want = tonal.notes.map((n) => Note.chroma(n));
          expect([...c.pcs].sort((a, b) => a - b), symbol).toEqual([...want].sort((a, b) => a - b));
        }
      }
    }
  });
});

describe("chord notes are spelled for the key", () => {
  it("V in B major is F♯ A♯ C♯, and IV in G♭ major is C♭ E♭ G♭", () => {
    expect(chordOf({ ring: "maj", col: 6 }, { col: 5, mode: "major" }).notes).toEqual(["F♯", "A♯", "C♯"]);
    expect(chordOf({ ring: "maj", col: 5 }, { col: 6, mode: "major" }).notes).toEqual(["C♭", "E♭", "G♭"]);
  });
  it("match the chord's pitch classes and an independent speller, in every key", () => {
    const ascii = (s: string) => s.replaceAll("♯", "#").replaceAll("♭", "b").replaceAll("𝄪", "##");
    for (let col = 0; col < 12; col++) {
      for (const mode of ["major", "minor"] as const) {
        for (const c of circleChords({ col, mode })) {
          expect(c.notes.map((n) => Note.chroma(ascii(n))), c.name).toEqual(c.pcs);
          const symbol = ascii(c.name).replace("°", "dim");
          expect(c.notes.map(ascii), c.name).toEqual(TonalChord.get(symbol).notes);
        }
      }
    }
  });
});

describe("withOctave", () => {
  it("goes by the letter, so the odd ones are right", () => {
    expect(withOctave("C", 60)).toBe("C4");
    expect(withOctave("C♭", 59)).toBe("C♭4");
    expect(withOctave("B♯", 60)).toBe("B♯3");
    expect(withOctave("F♯", 66)).toBe("F♯4");
    expect(withOctave("B", 59)).toBe("B3");
  });
  it("agrees with an independent source, on every spelling a chord can use", () => {
    const ascii = (s: string) => s.replaceAll("♯", "#").replaceAll("♭", "b").replaceAll("𝄪", "##");
    for (let col = 0; col < 12; col++) {
      for (const c of circleChords({ col, mode: "major" })) {
        c.notes.forEach((name, i) => {
          for (let midi = 36; midi < 89; midi++) {
            if (midi % 12 !== c.pcs[i]) continue;
            expect(Note.midi(ascii(withOctave(name, midi))), `${name} ${midi}`).toBe(midi);
          }
        });
      }
    }
  });
});

describe("alterations", () => {
  const G: ChordRef = { ring: "maj", col: 1 };
  const Dm: ChordRef = { ring: "min", col: 11 };
  const Em: ChordRef = { ring: "min", col: 1 };
  const AMINOR: Key = { col: 0, mode: "minor" };
  const with_ = (...as: Alteration[]) => as.reduce(toggleAlteration, PLAIN);

  it("in A minor, v is Em, raised it's E, and with a 7 it's E7, labeled V7, with G♯ the leading tone", () => {
    const v = chordOf(Em, AMINOR);
    expect([v.name, v.numeral, v.leadingTone]).toEqual(["Em", "v", null]);
    const V = chordOf(Em, AMINOR, { ...PLAIN, quality: "major" });
    expect([V.name, V.numeral, V.leadingTone]).toEqual(["E", "V", 8]);
    expect(V.notes).toEqual(["E", "G♯", "B"]);
    const V7 = chordOf(Em, AMINOR, { top: "7", sus: null, quality: "major" });
    expect([V7.name, V7.numeral, V7.leadingTone]).toEqual(["E7", "V7", 8]);
    expect(V7.notes).toEqual(["E", "G♯", "B", "D"]);
  });
  it("only v in a minor key can be raised", () => {
    expect(canRaise(Em, AMINOR)).toBe(true);
    expect(canRaise(Em, C)).toBe(false);
    expect(canRaise({ ring: "min", col: 0 }, AMINOR)).toBe(false);
    expect(canRaise({ ring: "maj", col: 1 }, AMINOR)).toBe(false);
    expect(canRaise({ ring: "min", col: 3 }, { col: 2, mode: "minor" })).toBe(true); // F♯m in B minor
  });
  it("holding V in C major, 7, 9, add9, sus2 and sus4 are in key, and maj7 and minor aren't", () => {
    const fits = ALTERATIONS.filter((a) => canAlter("maj", a)).map((a) => [a, fitsKey(chordOf(G, C, with_(a)), C)]);
    expect(Object.fromEntries(fits)).toEqual({ "7": true, maj7: false, "9": true, add9: true, sus2: true, sus4: true, minor: false });
  });
  it("sus chords on a minor cell are named by root alone", () => {
    expect(chordOf(Dm, C, with_("sus4")).name).toBe("Dsus4");
    expect(chordOf(Dm, C, with_("sus2")).name).toBe("Dsus2");
    expect(chordOf(Dm, C, with_("7", "sus4")).name).toBe("D7sus4");
    expect(chordOf(Dm, C, with_("sus4")).numeral).toBe("iisus4");
  });
  it("names and numerals carry the quality", () => {
    const named = (ref: ChordRef, ...as: Alteration[]) => {
      const c = chordOf(ref, C, with_(...as));
      return `${c.name} ${c.numeral}`;
    };
    expect(named(G, "7")).toBe("G7 V7");
    expect(named({ ring: "maj", col: 11 }, "maj7")).toBe("Fmaj7 IVmaj7");
    expect(named(Dm, "7")).toBe("Dm7 ii7");
    expect(named(Dm, "maj7")).toBe("Dm(maj7) iimaj7");
    expect(named(Dm, "9")).toBe("Dm9 ii9");
    expect(named(Dm, "add9")).toBe("Dm(add9) iiadd9");
    expect(named(G, "sus4", "7")).toBe("G7sus4 V7sus4");
    expect(named(G, "add9", "sus4")).toBe("Gsus4add9 Vsus4add9");
    expect(named({ ring: "dim", col: 0 }, "7")).toBe("Bø7 viiø7");
  });
  it("7, maj7, 9 and add9 replace each other, and so do the two sus, but one of each can stack", () => {
    expect(with_("7", "maj7").top).toBe("maj7");
    expect(with_("sus2", "sus4").sus).toBe("sus4");
    expect(with_("7", "sus4")).toEqual({ top: "7", sus: "sus4", quality: null });
    expect(with_("7", "7")).toEqual(PLAIN);
  });
  it("a sus2 and a 9th are the same note, so one replaces the other", () => {
    expect(with_("9", "sus2")).toEqual({ top: null, sus: "sus2", quality: null });
    expect(with_("sus2", "add9")).toEqual({ top: "add9", sus: null, quality: null });
    expect(with_("7", "sus2")).toEqual({ top: "7", sus: "sus2", quality: null });
  });
  it("Major and Minor replace each other, and stack with the rest", () => {
    expect(with_("major", "minor").quality).toBe("minor");
    expect(with_("minor", "7")).toEqual({ top: "7", sus: null, quality: "minor" });
    expect(with_("minor", "minor")).toEqual(PLAIN);
    expect(canAlter("maj", "major")).toBe(false);
    expect(canAlter("min", "minor")).toBe(false);
    expect(canAlter("dim", "major") && canAlter("dim", "minor")).toBe(true);
  });
  it("the parallel minor is spelled from the same root: C made minor has E♭, in any key", () => {
    expect(chordOf({ ring: "maj", col: 0 }, C, with_("minor")).notes).toEqual(["C", "E♭", "G"]);
    expect(chordOf({ ring: "min", col: 2 }, { col: 1, mode: "major" }, with_("major")).notes).toEqual(["B", "D♯", "F♯"]);
    expect(chordOf({ ring: "dim", col: 0 }, C, with_("major")).notes).toEqual(["B", "D♯", "F♯"]);
  });
  it("a diminished chord takes no sus", () => {
    expect(canAlter("dim", "sus4")).toBe(false);
    expect(canAlter("dim", "7")).toBe(true);
    expect(canAlter("min", "sus4")).toBe(true);
  });
  it("a 9th chord on four voices keeps root, 3rd, 7th and 9th, and the 5th goes first", () => {
    expect(chordOf(G, C, with_("9")).keep).toEqual([7, 11, 5, 9, 2]);
    expect(chordOf(G, C).keep).toEqual([7, 11, 2]);
    expect(chordOf(G, C, with_("sus4")).keep).toEqual([7, 0, 2]);
  });

  /** An independent source for every note of every chord, spelling included. */
  const toTonal = (name: string) =>
    name.replace(/♯/g, "#").replace(/𝄪/g, "##").replace(/♭/g, "b")
      .replace("m(maj7)", "mMaj7").replace("m(add9)", "madd9").replace("ø7", "m7b5").replace("ø9", "m9b5");
  const plainNote = (n: string) => n.replace(/♯/g, "#").replace(/𝄪/g, "##").replace(/♭/g, "b");

  it("every chord's notes agree with Tonal, spelling included, on every cell in every key", () => {
    let checked = 0;
    const mismatches: string[] = [];
    for (const mode of ["major", "minor"] as const) {
      for (let col = 0; col < 12; col++) {
        const key: Key = { col, mode };
        const alts: Alts[] = [
          PLAIN,
          ...ALTERATIONS.map((a) => with_(a)),
          with_("7", "sus4"), with_("9", "sus4"), with_("7", "sus2"),
          with_("major", "7"), with_("minor", "7"), with_("minor", "9"),
        ];
        for (const cell of circleChords(key)) {
          for (const a of alts) {
            if ((a.sus && cell.ref.ring === "dim") || (a.quality && !canAlter(cell.ref.ring, a.quality))) continue;
            const c = chordOf(cell.ref, key, a);
            const t = TonalChord.get(toTonal(c.name));
            if (t.empty) continue; // Tonal doesn't know every name, and names tested below stand on their own
            checked++;
            const ours = [...c.notes].map(plainNote).sort().join();
            const theirs = [...t.notes].sort().join();
            if (ours !== theirs) mismatches.push(`${c.name}: ${ours} vs ${theirs}`);
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(checked).toBeGreaterThan(2000);
  });
  it("pitch classes always match the spelled notes", () => {
    for (let col = 0; col < 12; col++) {
      const key: Key = { col, mode: "major" };
      for (const cell of circleChords(key)) {
        for (const a of ALTERATIONS) {
          if (!canAlter(cell.ref.ring, a)) continue;
          const c = chordOf(cell.ref, key, with_(a));
          const pcOf = (n: string) =>
            ([...n.slice(1)].reduce((sum, x) => sum + (x === "♯" ? 1 : x === "𝄪" ? 2 : x === "♭" ? -1 : 0), { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[n[0]]!) + 12) % 12;
          expect(c.notes.map(pcOf), c.name).toEqual(c.pcs);
          expect([...c.keep].sort(), c.name).toEqual([...c.pcs].sort());
        }
      }
    }
  });
});

describe("transition weights", () => {
  const AM: Key = { col: 0, mode: "minor" };
  const refOf = (key: Key, numeral: string) => inKey(key).find((c) => c.numeral === numeral)!.ref;
  const numeralsOf = (ref: ChordRef, key: Key, preset = "pop") => nextChords(ref, key, preset).map((n) => chordOf(n.ref, key).numeral);

  it("keeps proportions only, with no totals to multiply them back into counts", () => {
    for (const set of [corpus.pop, corpus.modern, corpus.jazz]) {
      expect(Object.keys(set).sort()).toEqual(["major", "minor", "songs", "source"]);
      for (const table of [set.major, set.minor]) {
        expect(Object.keys(table)).toEqual(["rows"]);
        for (const row of Object.values(table.rows)) expect(Object.keys(row)).toEqual(["to"]);
      }
    }
  });

  it("every row comes from a counted corpus, sums to 1 or less, and names real numerals", () => {
    expect(PRESETS.map((p) => [p.id, p.name, p.songs])).toEqual([["pop", "Modern pop", 15213], ["classic", "Classic pop", 739], ["jazz", "Jazz", 1185]]);
    for (const preset of PRESETS) {
      expect(preset.source).toMatch(/Hooktheory|Billboard|iRb/);
      for (const mode of ["major", "minor"] as const) {
        const key: Key = { col: 0, mode };
        const core = mode === "major" ? ["I", "ii", "iii", "IV", "V", "vi"] : ["i", "III", "iv", "v", "VI", "VII"];
        for (const n of core) expect(Object.keys(preset[mode]), `${preset.id} ${mode} has a row for ${n}`).toContain(n);
        for (const [from, row] of Object.entries(preset[mode])) {
          const sum = Object.values(row).reduce((t, w) => t + w.p, 0);
          expect(sum, `${preset.id} ${mode} ${from}`).toBeLessThanOrEqual(1.001); // four-decimal rounding
          for (const [to, w] of Object.entries(row)) {
            expect(to, `${preset.id} ${from} to ${to}`).toMatch(/^[♭♯]?(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)°?$/);
            expect(w.source).toBe("measured");
          }
        }
        expect(key.mode).toBe(mode);
      }
    }
  });
  it("the Billboard counts agree with Hooktheory's shape after I: IV first, then V", () => {
    const pop = PRESETS.find((p) => p.id === "classic")!;
    expect(pop.major.I.IV.p).toBeGreaterThan(pop.major.I.V.p);
    expect(pop.major.I.V.p).toBeGreaterThan(pop.major.I.vi.p);
    const jazz = PRESETS.find((p) => p.id === "jazz")!;
    expect(jazz.major.ii.V.p).toBeGreaterThan(0.7); // ii-V, the thing jazz is made of
  });
  it("modern pop goes V to vi far more than classic pop did", () => {
    const modern = PRESETS.find((p) => p.id === "pop")!, classic = PRESETS.find((p) => p.id === "classic")!;
    expect(modern.major.V.vi.p).toBeGreaterThan(2 * classic.major.V.vi.p);
  });
  it("in C major, holding G shows a solid arrow to C", () => {
    const arrow = nextChords(refOf(C, "V"), C, "pop").find((n) => chordOf(n.ref, C).numeral === "I")!;
    expect(arrow.solid).toBe(true);
    expect(arrow.source).toBe("measured");
    expect(arrow.p).toBe(PRESETS.find((p) => p.id === "pop")!.major.V.I.p);
  });
  it("in C major, Em would be dashed, since that move isn't a falling fifth", () => {
    const jazz = nextChords(refOf(C, "IV"), C, "jazz").find((n) => chordOf(n.ref, C).numeral === "iii")!;
    expect(jazz.solid).toBe(false);
  });
  it("ii to V is solid: its root falls a fifth, wherever the two cells sit on the circle", () => {
    const arrow = nextChords(refOf(C, "ii"), C, "pop").find((n) => chordOf(n.ref, C).numeral === "V")!;
    expect(arrow.solid).toBe(true);
    for (const [from, to] of [["vi", "ii"], ["iii", "vi"], ["I", "IV"]]) {
      const a = nextChords(refOf(C, from), C, "jazz").concat(nextChords(refOf(C, from), C, "pop")).find((n) => chordOf(n.ref, C).numeral === to)!;
      expect(a.solid, `${from} to ${to}`).toBe(true);
    }
  });
  it("arrows come strongest first, and work in every key by rotation", () => {
    for (let col = 0; col < 12; col++) {
      const key: Key = { col, mode: "major" };
      // The same chords relative to the key in every key, even where a key spells one differently.
      const rel = (k: Key) => nextChords(refOf(k, "I"), k, "pop").map((n) => `${n.ref.ring}${mod(chordOf(n.ref, k).root - tonicPc(k), 12)}`);
      expect(rel(key)).toEqual(rel(C));
      expect(numeralsOf(refOf(key, "I"), key).slice(0, 2)).toEqual(["IV", "V"]);
      const a = nextChords(refOf(key, "I"), key, "pop");
      expect(a.map((n) => n.p)).toEqual([...a.map((n) => n.p)].sort((x, y) => y - x));
    }
  });
  it("minor keys read from their own table", () => {
    expect(numeralsOf(refOf(AM, "v"), AM)[0]).toBe("i");
    expect(numeralsOf(refOf(AM, "VI"), AM)[0]).toBe("VII");
  });
  it("a raised V has its own row, and it heads home", () => {
    const arrows = nextChords(refOf(AM, "v"), AM, "pop", { top: null, sus: null, quality: "major" });
    expect(chordOf(arrows[0].ref, AM).numeral).toBe("i");
    expect(arrows[0].p).toBe(PRESETS.find((p) => p.id === "pop")!.minor.V.i.p);
  });
  it("an outside chord the corpora count goes by its own row: D in C (II) heads for V, measured", () => {
    const D: ChordRef = { ring: "maj", col: 2 };
    const [arrow] = nextChords(D, C, "jazz");
    expect(chordOf(arrow.ref, C).numeral).toBe("V");
    expect(arrow.source).toBe("measured");
    expect(arrow.solid).toBe(true);
    const Bflat: ChordRef = { ring: "maj", col: 10 }; // ♭VII, pop's favorite borrowed chord
    expect(chordOf(nextChords(Bflat, C, "classic")[0].ref, C).numeral).toBe("IV");
  });
  it("a chord with no row of its own falls back to the old rules, marked as estimates", () => {
    const classic = PRESETS.find((p) => p.id === "classic")!;
    const rowless = circleChords(C).filter((c) => !classic.major[c.numeral]);
    expect(rowless.length).toBeGreaterThan(0);
    for (const c of rowless) {
      const arrows = nextChords(c.ref, C, "classic");
      expect(arrows.length, c.numeral).toBe(1);
      expect(arrows[0].source, c.numeral).toBe("estimate");
    }
  });
  it("an unknown preset shows nothing", () => {
    expect(nextChords(refOf(C, "I"), C, "showtune")).toEqual([]);
  });
});

describe("an outside chord's name follows its numeral", () => {
  const LETTERS = "CDEFGAB";
  const DEG: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7 };
  const degree = (numeral: string) => DEG[numeral.replace(/[^IViv]/g, "").toLowerCase()];
  const tonicLetter = (key: Key) => chordOf({ ring: key.mode === "major" ? "maj" : "min", col: key.col }, key).name[0];
  const agrees = (name: string, numeral: string, key: Key) =>
    name[0] === LETTERS[(LETTERS.indexOf(tonicLetter(key)) + degree(numeral) - 1) % 7];

  it("in every key, on every ring, and with the quality changed", () => {
    for (let col = 0; col < 12; col++) {
      for (const mode of ["major", "minor"] as const) {
        const key: Key = { col, mode };
        for (const c of circleChords(key)) expect(agrees(c.name, c.numeral, key), `${c.name} ${c.numeral} in ${col} ${mode}`).toBe(true);
        for (let cell = 0; cell < 12; cell++) {
          for (const quality of ["major", "minor"] as const) {
            const c = chordOf({ ring: quality === "major" ? "min" : "maj", col: cell }, key, { top: null, sus: null, quality });
            expect(agrees(c.name, c.numeral, key), `${c.name} ${c.numeral} in ${col} ${mode}`).toBe(true);
          }
        }
      }
    }
  });
  it("in E minor: D♯ ♯VII, F♯ II, C♯ ♯VI and G♯ ♯III, not E♭, G♭, D♭ and A♭", () => {
    const Em: Key = { col: 1, mode: "minor" };
    const at = (col: number) => chordOf({ ring: "maj", col }, Em);
    expect([9, 6, 7, 8].map((c) => `${at(c).name} ${at(c).numeral}`)).toEqual(["D♯ ♯VII", "F♯ II", "C♯ ♯VI", "G♯ ♯III"]);
  });
  it("in C major the outside minor chords keep their usual names: F♯m ♯iv, C♯m ♯i, G♯m ♯v, E♭m ♭iii, B♭m ♭vii", () => {
    const C: Key = { col: 0, mode: "major" };
    const at = (col: number) => chordOf({ ring: "min", col }, C);
    expect([3, 4, 5, 6, 7].map((c) => `${at(c).name} ${at(c).numeral}`)).toEqual(["F♯m ♯iv", "C♯m ♯i", "G♯m ♯v", "E♭m ♭iii", "B♭m ♭vii"]);
  });
  it("takes the plain name and numbers it from that when the numeral's spelling needs a double accidental", () => {
    const gSharpMinor: Key = { col: 5, mode: "minor" };
    const g = chordOf({ ring: "maj", col: 1 }, gSharpMinor); // the G major chord: ♯VII would be F𝄪
    expect(`${g.name} ${g.numeral}`).toBe("G ♭I");
  });
});

describe("secondary dominants", () => {
  const leads = (ref: ChordRef, key: Key = C) => {
    const target = secondaryDominant(chordOf(ref, key).root);
    return chordOf(target, key, DOMINANT_7);
  };
  it("in C: G7 leads to C, A7 to Dm, B7 to Em, C7 to F, D7 to G, E7 to Am", () => {
    const names = (["maj-0", "min-11", "min-1", "maj-11", "maj-1", "min-0"] as const).map((k) => {
      const [ring, col] = k.split("-");
      return leads({ ring: ring as ChordRef["ring"], col: Number(col) }).name;
    });
    expect(names).toEqual(["G7", "A7", "B7", "C7", "D7", "E7"]);
  });
  it("each is a dominant 7th a fifth above, spelled as the key's V of that chord", () => {
    const e7 = leads({ ring: "min", col: 0 });
    expect(e7.notes).toEqual(["E", "G♯", "B", "D"]);
    expect(TonalChord.get("E7").notes).toEqual(e7.notes.map((n) => n.replace("♯", "#")));
  });
  it("works in a minor key too: in A minor, E7 leads to Am and A7 to Dm", () => {
    const AM: Key = { col: 0, mode: "minor" };
    expect(leads({ ring: "min", col: 0 }, AM).name).toBe("E7");
    expect(leads({ ring: "min", col: 11 }, AM).name).toBe("A7");
  });
});
