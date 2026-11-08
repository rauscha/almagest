/**
 * MIDI out: the same commands the voices get, sent to a synth as notes. A voice that holds a shared note
 * gets no command, so nothing is sent and the note really holds on the far synth. A slide goes out as a
 * re-strike, because everything shares one channel and a pitch bend would bend the whole chord.
 */
import type { MidiDevice, MidiStatus } from "../core/contract";
import type { VoiceCommand } from "../core/reduce";

const NOTE_ON = 0x90;
const NOTE_OFF = 0x80;
/** A touchscreen has no velocity, so every note is struck alike. */
const VELOCITY = 100;

/** Turns voice commands into note messages. Knows nothing about ports, so it can be tested on its own. */
export class MidiVoices {
  /** The note each voice is holding. */
  private held: (number | null)[] = [];
  /** How many voices are on each note: two voices can share a pitch, and one leaving mustn't end it. */
  private voicesOn = new Map<number, number>();
  channel = 1;

  constructor(private send: (bytes: number[]) => void) {}

  /** All the releases go first, so a pitch one voice leaves and another takes is struck again, as it is in the app. */
  apply(commands: VoiceCommand[]): void {
    const strikes: { voice: number; midi: number }[] = [];
    for (const c of commands) {
      if (c.kind === "allOff") this.releaseAll();
      else {
        this.release(c.voice);
        if (c.kind !== "off") strikes.push({ voice: c.voice, midi: c.midi });
      }
    }
    for (const { voice, midi } of strikes) this.strike(voice, midi);
  }

  releaseAll(): void {
    this.held.forEach((_, voice) => this.release(voice));
  }

  /** Forgets every note without sending anything, for a port that has gone away. */
  forget(): void {
    this.held = [];
    this.voicesOn.clear();
  }

  private strike(voice: number, midi: number) {
    if (midi < 0 || midi > 127) return;
    const on = this.voicesOn.get(midi) ?? 0;
    if (on === 0) this.send([NOTE_ON | (this.channel - 1), midi, VELOCITY]);
    this.voicesOn.set(midi, on + 1);
    this.held[voice] = midi;
  }

  private release(voice: number) {
    const midi = this.held[voice];
    if (midi === null || midi === undefined) return;
    this.held[voice] = null;
    const on = (this.voicesOn.get(midi) ?? 1) - 1;
    if (on > 0) {
      this.voicesOn.set(midi, on);
      return;
    }
    this.voicesOn.delete(midi);
    this.send([NOTE_OFF | (this.channel - 1), midi, 0]);
  }
}

/** The real thing: Chrome's Web MIDI, a choice of port, and no note left stuck when anything changes. */
export class MidiLink {
  private access: MIDIAccess | null = null;
  private output: MIDIOutput | null = null;
  private voices = new MidiVoices((bytes) => {
    try {
      this.output?.send(bytes);
    } catch {
      /* the port went away between the check and the send; the state change that follows clears it */
    }
  });

  constructor(private report: (outputs: MidiDevice[], status: MidiStatus) => void) {}

  async ask(): Promise<void> {
    if (!("requestMIDIAccess" in navigator)) return this.report([], "unsupported");
    try {
      this.access = await navigator.requestMIDIAccess();
    } catch {
      return this.report([], "denied");
    }
    this.access.onstatechange = () => this.changed();
    this.changed();
  }

  private changed() {
    if (!this.access) return;
    if (this.output && this.access.outputs.get(this.output.id)?.state !== "connected") {
      this.voices.forget();
      this.output = null;
    }
    const outputs = [...this.access.outputs.values()]
      .filter((o) => o.state === "connected" && !/through/i.test(o.name ?? ""))
      .map((o) => ({ id: o.id, name: o.name ?? "MIDI device" }));
    this.report(outputs, "ready");
  }

  /** Where the notes go. A change ends whatever was playing first, on the old port and channel. */
  use(outputId: string | null, channel: number): void {
    if ((this.output?.id ?? null) === outputId && this.voices.channel === channel) return;
    this.voices.releaseAll();
    this.output = outputId ? (this.access?.outputs.get(outputId) ?? null) : null;
    this.voices.channel = channel;
  }

  apply(commands: VoiceCommand[]): void {
    if (this.output) this.voices.apply(commands);
  }
}
