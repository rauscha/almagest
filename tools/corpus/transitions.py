#!/usr/bin/env python3
"""
Counts chord-to-chord transitions in three published corpora and writes the tables Almagest uses for its
next-chord stars.

  classic pop: the McGill Billboard Project annotations (Burgoyne, Wild & Fujinaga, 2011), salami_chords.txt
  modern pop:  Hooktheory's TheoryTab annotations as released with Sheet Sage (Donahue, Thickstun & Liang, 2022)
  jazz:        the iRb corpus of jazz standards (Broze & Shanahan, 2013), as serialized in sharp11-irb

Only the resulting proportions go into the repo (src/theory/corpus.json), never the counts behind them.
The corpora themselves are read from wherever they were downloaded. Run with -I so nothing near the data can be imported:

  python3 -I tools/corpus/transitions.py <billboard dir> <sharp11-irb index.js> <Hooktheory.json.gz> src/theory/corpus.json

Method, kept deliberately close to how Almagest names chords (src/theory/keyLens.ts):
- Every chord becomes a numeral relative to the key in force: a major, minor or diminished triad on a
  root. Extensions fold into the triad (G7 and Gmaj7 count as G); sus, power, augmented and unclear
  chords break the chain rather than guess.
- Repeats of the same numeral collapse, so a transition is always to a different chord.
- Billboard gives a tonic but not a mode. A stretch in one tonic is called minor when its tonic chord
  appears more often minor than major. iRb gives the mode.
- Billboard repeats some songs in several chart slots; each song counts once.
- Hooktheory gives each section's key as a scale. Ionian, Mixolydian and Lydian count as major; Aeolian,
  Dorian and Phrygian as minor; anything rarer is skipped. Each annotated section is its own chain.
"""
import collections
import json
import os
import re
import sys

PITCH = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
ROMAN = {
    "major": {
        "maj": ["I", "♭II", "II", "♭III", "III", "IV", "♭V", "V", "♭VI", "VI", "♭VII", "VII"],
        "min": ["I", "♯I", "II", "♭III", "III", "IV", "♯IV", "V", "♯V", "VI", "♭VII", "VII"],
    },
    "minor": {
        "maj": ["I", "♭II", "II", "III", "♯III", "IV", "♭V", "V", "VI", "♯VI", "VII", "♯VII"],
        "min": ["I", "♭II", "II", "III", "♯III", "IV", "♭V", "V", "VI", "♯VI", "VII", "♯VII"],
    },
}


def pc(root):
    n = PITCH[root[0]]
    for ch in root[1:]:
        n += 1 if ch in "#♯" else -1 if ch in "b♭" else 0
    return n % 12


def numeral(root_pc, quality, tonic_pc, mode):
    """The numeral Almagest would give this triad in this key, in keyLens.ts's convention."""
    d = (root_pc - tonic_pc) % 12
    if quality == "maj":
        return ROMAN[mode]["maj"][d]
    base = ROMAN[mode]["min"][d].lower()
    return base + "°" if quality == "dim" else base


# --- Billboard ------------------------------------------------------------------------------------

def harte_quality(shorthand):
    s = shorthand.split("/")[0]
    s = s.split("(")[0]
    if s in ("maj", "7", "maj7", "9", "maj9", "maj6", "11", "13", "maj13"):
        return "maj"
    if s.startswith("min") or s in ("min7", "min9", "min6", "min11", "minmaj7"):
        return "min"
    if s in ("dim", "dim7", "hdim7"):
        return "dim"
    return None  # sus, power chords, augmented, unisons, anything unclear


def billboard_songs(root):
    seen = set()
    for dirpath, _, files in os.walk(root):
        if "salami_chords.txt" not in files:
            continue
        lines = open(os.path.join(dirpath, "salami_chords.txt"), encoding="utf-8", errors="replace").read().splitlines()
        meta = {l.split(":", 1)[0][2:].strip(): l.split(":", 1)[1].strip() for l in lines if l.startswith("# ") and ":" in l}
        ident = (meta.get("title", "").lower(), meta.get("artist", "").lower())
        if ident in seen:
            continue
        seen.add(ident)
        # A list of stretches, each [tonic_pc, [(root_pc, quality or None), ...]].
        stretches, tonic = [], None
        for l in lines:
            if l.startswith("# tonic:"):
                tonic = pc(l.split(":", 1)[1].strip())
                stretches.append([tonic, []])
                continue
            if l.startswith("#") or tonic is None:
                continue
            for bar in re.findall(r"\|([^|]*)(?=\|)", l):
                for tok in bar.split():
                    if tok == ".":  # the chord before carries on
                        continue
                    if tok in ("N", "X", "&pause", "*"):
                        stretches[-1][1].append(None)
                        continue
                    if ":" not in tok:
                        continue
                    r, q = tok.split(":", 1)
                    if not re.fullmatch(r"[A-G][b#]*", r):
                        stretches[-1][1].append(None)
                        continue
                    quality = harte_quality(q)
                    stretches[-1][1].append((pc(r), quality) if quality else None)
        yield stretches


def billboard(root):
    for stretches in billboard_songs(root):
        song = []
        for tonic, chords in stretches:
            on_tonic = [q for c in chords if c for (r, q) in [c] if r == tonic]
            mode = "minor" if on_tonic.count("min") > on_tonic.count("maj") else "major"
            song.append((mode, [numeral(r, q, tonic, mode) if q else None for c in chords for (r, q) in [c or (0, None)]]))
        yield song


# --- iRb ------------------------------------------------------------------------------------------

def irb_quality(rest):
    if rest.startswith("maj"):
        return "maj"
    if rest.startswith("min") or (rest.startswith("m") and not rest.startswith("maj")) or rest.startswith("-"):
        return "min"
    if rest.startswith("ø") or rest.startswith("o") or rest.startswith("dim"):
        return "dim"
    if rest.startswith("+") or rest.startswith("aug") or "sus" in rest:
        return None
    return "maj"  # plain triad, 6, 7, 9, 13 and altered dominants


def irb(path):
    raw = open(path, encoding="utf-8").read()
    data = json.loads(raw[raw.index("{"): raw.rstrip().rstrip(";").rindex("}") + 1])
    for chart in data["charts"]:
        info = chart["info"]
        mode = "minor" if info.get("minor") else "major"
        tonic = pc(info["key"])
        out = []
        for section in chart["sections"]:
            for item in chart["content"].get(section, []):
                m = re.fullmatch(r"([A-G][b#]?)(.*)", item["chord"].split("/")[0])
                if not m:
                    out.append(None)
                    continue
                q = irb_quality(m.group(2))
                out.append(numeral(pc(m.group(1)), q, tonic, mode) if q else None)
        yield [(mode, out)]


# --- Hooktheory ---------------------------------------------------------------------------------

MAJOR_SCALES = {(2, 2, 1, 2, 2, 2), (2, 2, 1, 2, 2, 1), (2, 2, 2, 1, 2, 2)}
MINOR_SCALES = {(2, 1, 2, 2, 1, 2), (2, 1, 2, 2, 2, 1), (1, 2, 2, 2, 1, 2)}


def hooktheory(path):
    import gzip
    data = json.load(gzip.open(path))
    for item in data.values():
        a = item["annotations"]
        keys = sorted(a.get("keys") or [], key=lambda k: k["beat"])
        if not keys:
            continue
        stretches = []  # (mode, [numeral or None]) per key in force
        current = None
        for h in sorted(a.get("harmony") or [], key=lambda h: h["onset"]):
            key = [k for k in keys if k["beat"] <= h["onset"]]
            key = key[-1] if key else keys[0]
            scale = tuple(key["scale_degree_intervals"])
            mode = "major" if scale in MAJOR_SCALES else "minor" if scale in MINOR_SCALES else None
            if (id(key), mode) != current:
                current = (id(key), mode)
                stretches.append((mode, []))
            if mode is None:
                stretches[-1][1].append(None)
                continue
            iv = tuple(h["root_position_intervals"][:2])
            q = {(4, 3): "maj", (3, 4): "min", (3, 3): "dim"}.get(iv)
            stretches[-1][1].append(numeral(h["root_pitch_class"], q, key["tonic_pitch_class"], mode) if q else None)
        yield [(m, c) for m, c in stretches if m]


# --- counting -------------------------------------------------------------------------------------

def count(songs):
    tables = {"major": collections.defaultdict(collections.Counter), "minor": collections.defaultdict(collections.Counter)}
    n_songs = 0
    for song in songs:
        n_songs += 1
        for mode, chords in song:
            prev = None
            for c in chords:
                if c is None:
                    prev = None
                    continue
                if c == prev:
                    continue
                if prev is not None:
                    tables[mode][prev][c] += 1
                prev = c
    return n_songs, tables


MIN_ROW = 20  # fewer transitions out of a chord than this, and its row isn't kept
MIN_P = 0.02  # rarer than this, and a target isn't kept


def shape(n_songs, tables, source):
    out = {"source": source, "songs": n_songs}
    for mode, rows in tables.items():
        kept = {}
        for frm, targets in rows.items():
            total = sum(targets.values())
            if total < MIN_ROW:
                continue
            kept[frm] = {
                "to": {to: round(k / total, 4) for to, k in targets.most_common() if k / total >= MIN_P},
            }
        out[mode] = {"rows": kept}
    return out


def main():
    bb_dir, irb_js, ht_gz, out_path = sys.argv[1:5]
    pop = shape(*count(billboard(bb_dir)), "McGill Billboard Project, chart songs 1958 to 1991 (Burgoyne, Wild & Fujinaga, 2011)")
    modern = shape(*count(hooktheory(ht_gz)), "Hooktheory TheoryTab annotations, mostly 2000s and 2010s (Donahue, Thickstun & Liang, 2022)")
    # Hooktheory annotates sections; say how many songs those come from.
    import gzip
    ht = json.load(gzip.open(ht_gz))
    modern["songs"] = len({(x["hooktheory"]["artist"], x["hooktheory"]["song"]) for x in ht.values()})
    jazz = shape(*count(irb(irb_js)), "iRb jazz corpus (Broze & Shanahan, 2013)")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"pop": pop, "modern": modern, "jazz": jazz, "method": "tools/corpus/transitions.py"}, f, ensure_ascii=False, indent=1)
    for name, t in (("classic pop", pop), ("modern pop", modern), ("jazz", jazz)):
        print(name, t["songs"], "songs;", {m: len(t[m]["rows"]) for m in ("major", "minor")})


if __name__ == "__main__":
    main()
