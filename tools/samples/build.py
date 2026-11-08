#!/usr/bin/env python3
"""
Turns the source recordings into the small files Almagest ships in public/samples.

  Grand Piano:        Salamander Grand Piano V3 (Ogg Vorbis bundle), one velocity layer, every minor third
  Orchestral Strings: the violin and cello sections of VSCO 2 Community Edition, as mono loops

The sources are read from wherever they were downloaded and aren't kept in the repo. Run with -I so nothing
near the data can be imported. Needs numpy and ffmpeg:

  python3 -I tools/samples/build.py <folder of Salamander .ogg files> <folder of string .mp3 files> public/samples

The strings folder holds vsco2-violin-section-<midi>.mp3 and vsco2-cello-section-<midi>.mp3, from
midi.community/sounds/vsco2-violin-section/<midi>.mp3 and the cello's equivalent. The note lists must match
PIANO_ROOTS and STRING_ROOTS in src/voices/recorded.ts.
"""
import os
import subprocess
import sys

import numpy as np

RATE = 44100
PIANO_NOTES = list(range(33, 91, 3))  # A1 to F#6, every minor third, as the piano was sampled
PIANO_LAYER = 10  # of 16: a firm touch, since a touchscreen gives every press one velocity
PIANO_PEAK = 0.7
CELLO_NOTES = [36, 43, 50, 57]
VIOLIN_NOTES = [62, 69, 76, 83]
STRING_RMS = 0.12
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def decode(path, channels):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", str(channels), "-ar", str(RATE), "-"],
        check=True, capture_output=True,
    ).stdout
    data = np.frombuffer(raw, dtype=np.float32)
    return data.reshape(-1, channels)


def encode(samples, channels, path, kbps):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", str(channels), "-ar", str(RATE), "-i", "-",
         "-ar", "48000", "-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "on", path],
        input=samples.astype(np.float32).tobytes(), check=True,
    )


def pitch_error_cents(mono, midi):
    """How far the strongest partial near the expected fundamental is from it, to catch a misnamed file."""
    n = min(len(mono), RATE * 2)
    spectrum = np.abs(np.fft.rfft(mono[:n] * np.hanning(n)))
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    want = 440 * 2 ** ((midi - 69) / 12)
    band = (freqs > want * 0.9) & (freqs < want * 1.1)
    found = freqs[band][np.argmax(spectrum[band])]
    return 1200 * np.log2(found / want)


def piano_seconds(midi):
    """Low strings ring longest, and a phone has to hold all of this in memory, decoded."""
    return 14 if midi < 60 else 10 if midi <= 72 else 7


def lengthen_ring(audio):
    """
    Keeps the strike and raises what follows, so a note rings on. A close-miked note falls about 30 dB in its
    first second in the middle of the keyboard. This aims for a 10 dB fall after the strike, then 2.6 dB a second.
    The boost is limited so a recording's noise floor stays down.
    """
    hop = 220
    frames = len(audio) // hop
    mono = audio.mean(axis=1)
    level_db = np.array([10 * np.log10(np.mean(mono[i * hop: (i + 2) * hop] ** 2) + 1e-12) for i in range(frames)])
    start_db = level_db[:10].max()
    t = np.arange(frames) * hop / RATE
    target_db = start_db - 10 * (1 - np.exp(-t / 0.25)) - 2.6 * t
    boost_db = np.clip(target_db - level_db, 0, 26)
    kernel = np.hanning(61) / np.hanning(61).sum()  # about 300 ms, so the gain moves too slowly to pump
    boost_db = np.convolve(np.pad(boost_db, 30, mode="edge"), kernel, mode="valid")
    boost_db[:12] = boost_db[:12] * np.linspace(0, 1, 12)  # the strike itself is left alone
    gain = 10 ** (np.interp(np.arange(len(audio)), np.arange(frames) * hop, boost_db) / 20)
    return audio * gain[:, None]


def build_piano(src, out):
    taken = []
    for midi in PIANO_NOTES:
        name = f"{NAMES[midi % 12]}{midi // 12 - 1}v{PIANO_LAYER}.ogg"
        audio = decode(os.path.join(src, name), 2)
        start = max(0, int(np.argmax(np.abs(audio).max(axis=1) > 0.003)) - int(0.002 * RATE))
        audio = lengthen_ring(audio[start:start + piano_seconds(midi) * RATE])
        fade =min(len(audio), int(1.5 * RATE))
        audio[-fade:] *= np.linspace(1, 0, fade)[:, None]
        cents = pitch_error_cents(audio.mean(axis=1), midi)
        if abs(cents) > 40:
            raise SystemExit(f"{name} is {cents:.0f} cents from MIDI {midi}")
        taken.append((midi, audio))
    gain = PIANO_PEAK / max(np.abs(a).max() for _, a in taken)  # one gain, so the piano keeps its own balance
    for midi, audio in taken:
        encode(audio * gain, 2, f"{out}/piano/{midi}.ogg", 88)
    print(f"piano: {len(taken)} notes, gain {gain:.2f}")


def seamless_loop(mono):
    """The steady middle of a note, its end crossfaded into its start at the best-matching point."""
    body = mono[int(0.15 * RATE): len(mono) - int(0.25 * RATE)]
    fade = int(0.25 * len(body))
    head = body[:fade]
    best, best_score = len(body), -2.0
    for end in range(len(body) - int(0.08 * RATE), len(body) + 1, 4):
        tail = body[end - fade:end]
        score = float(np.dot(head, tail) / (np.linalg.norm(head) * np.linalg.norm(tail) + 1e-9))
        if score > best_score:
            best, best_score = end, score
    ramp = np.linspace(0, 1, fade)
    loop = body[:best - fade].copy()
    loop[:fade] = body[:fade] * np.sqrt(ramp) + body[best - fade:best] * np.sqrt(1 - ramp)
    return loop, best_score


def build_strings(src, out):
    for section, notes in (("cello", CELLO_NOTES), ("violin", VIOLIN_NOTES)):
        for midi in notes:
            mono = decode(f"{src}/vsco2-{section}-section-{midi}.mp3", 1)[:, 0]
            cents = pitch_error_cents(mono, midi)
            if abs(cents) > 60:
                raise SystemExit(f"{section} {midi} is {cents:.0f} cents off")
            loop, score = seamless_loop(mono)
            loop = loop * (STRING_RMS / np.sqrt(np.mean(loop**2)))
            # Three passes in one file. The app loops the middle one, so the encoder's edges are never heard.
            encode(np.concatenate([loop, loop, loop])[:, None], 1, f"{out}/strings/{midi}.ogg", 64)
            print(f"strings: {section} {midi}, loop {len(loop) / RATE:.2f} s, match {score:.3f}")


if __name__ == "__main__":
    piano_dir, string_dir, out_dir = sys.argv[1:4]
    build_piano(piano_dir, out_dir)
    build_strings(string_dir, out_dir)
