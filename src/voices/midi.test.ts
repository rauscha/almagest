import { describe, expect, it } from "vitest";
import type { VoiceCommand } from "../core/reduce";
import { diffVoices } from "../core/reduce";
import { MidiLink, MidiVoices } from "./midi";

const ON = 0x90;
const OFF = 0x80;

function rig() {
  const sent: number[][] = [];
  return { sent, midi: new MidiVoices((b) => sent.push(b)) };
}
const on = (voice: number, midi: number): VoiceCommand => ({ kind: "on", voice, midi });

describe("MIDI out, from the voices' commands", () => {
  it("strikes each new note at one velocity on the chosen channel", () => {
    const { sent, midi } = rig();
    midi.channel = 3;
    midi.apply([on(0, 60), on(1, 64)]);
    expect(sent).toEqual([[ON | 2, 60, 100], [ON | 2, 64, 100]]);
  });

  it("sends nothing for a shared note, so it holds on the far synth", () => {
    const { sent, midi } = rig();
    midi.apply(diffVoices(null, [60, 64, 67]));
    sent.length = 0;
    midi.apply(diffVoices([60, 64, 67], [60, 65, 69]));
    expect(sent).toEqual([[OFF, 64, 0], [OFF, 67, 0], [ON, 65, 100], [ON, 69, 100]]);
    expect(sent.flat()).not.toContain(60);
  });

  it("re-strikes a slide, since a bend on one channel would bend the whole chord", () => {
    const { sent, midi } = rig();
    midi.apply(diffVoices(null, [60]));
    sent.length = 0;
    midi.apply(diffVoices([60], [62], { ms: 80 }));
    expect(sent).toEqual([[OFF, 60, 0], [ON, 62, 100]]);
  });

  it("strikes a pitch again when one voice leaves it and another takes it", () => {
    const { sent, midi } = rig();
    midi.apply(diffVoices(null, [60, 62]));
    sent.length = 0;
    midi.apply(diffVoices([60, 62], [62, 64]));
    expect(sent).toEqual([[OFF, 60, 0], [OFF, 62, 0], [ON, 62, 100], [ON, 64, 100]]);
  });

  it("keeps a pitch two voices share until the last of them lets go", () => {
    const { sent, midi } = rig();
    midi.apply([on(0, 60), on(1, 60)]);
    expect(sent).toEqual([[ON, 60, 100]]);
    midi.apply([{ kind: "off", voice: 0 }]);
    expect(sent).toHaveLength(1);
    midi.apply([{ kind: "off", voice: 1 }]);
    expect(sent.at(-1)).toEqual([OFF, 60, 0]);
  });

  it("ends every note on allOff, and leaves nothing to end twice", () => {
    const { sent, midi } = rig();
    midi.apply([on(0, 60), on(1, 64)]);
    sent.length = 0;
    midi.apply([{ kind: "allOff" }]);
    expect(sent).toEqual([[OFF, 60, 0], [OFF, 64, 0]]);
    sent.length = 0;
    midi.apply([{ kind: "allOff" }]);
    expect(sent).toEqual([]);
  });
});

describe("the MIDI link", () => {
  function port(id: string, name: string, state = "connected") {
    const sent: number[][] = [];
    return { id, name, state, sent, send: (b: number[]) => void sent.push(b) };
  }
  function link(...ports: ReturnType<typeof port>[]) {
    const access = { outputs: new Map(ports.map((p) => [p.id, p])), onstatechange: null as null | (() => void) };
    Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: async () => access });
    const reports: { outputs: { id: string; name: string }[]; status: string }[] = [];
    return { access, reports, midi: new MidiLink((outputs, status) => reports.push({ outputs, status })) };
  }

  it("lists real devices and leaves out the system's loopback", async () => {
    const { midi, reports } = link(port("a", "Synth"), port("t", "Midi Through Port-0"));
    await midi.ask();
    expect(reports.at(-1)).toEqual({ outputs: [{ id: "a", name: "Synth" }], status: "ready" });
  });

  it("ends what's playing when the channel or port changes", async () => {
    const a = port("a", "Synth");
    const b = port("b", "Other");
    const { midi } = link(a, b);
    await midi.ask();
    midi.use("a", 1);
    midi.apply([on(0, 60)]);
    midi.use("a", 2);
    expect(a.sent.at(-1)).toEqual([OFF, 60, 0]);
    midi.apply([on(0, 62)]);
    expect(a.sent.at(-1)).toEqual([ON | 1, 62, 100]);
    midi.use("b", 2);
    expect(a.sent.at(-1)).toEqual([OFF | 1, 62, 0]);
    midi.apply([on(0, 64)]);
    expect(b.sent).toEqual([[ON | 1, 64, 100]]);
  });

  it("says when it's refused, and stops sending when the port is unplugged", async () => {
    const a = port("a", "Synth");
    const { midi, access, reports } = link(a);
    await midi.ask();
    midi.use("a", 1);
    a.state = "disconnected";
    access.onstatechange!();
    expect(reports.at(-1)).toEqual({ outputs: [], status: "ready" });
    midi.apply([on(0, 60)]);
    expect(a.sent).toEqual([]);
    Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: () => Promise.reject(new Error("no")) });
    await midi.ask();
    expect(reports.at(-1)).toEqual({ outputs: [], status: "denied" });
  });
});
