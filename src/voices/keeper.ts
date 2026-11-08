/**
 * Keeps the audio alive across sleep, wake and the phone's own interruptions:
 *
 * - Going away: silence everything so nothing sticks, fade the output to nothing, then suspend, because
 *   voices cost full CPU whenever they exist. Suspending cuts the output dead, so anything still
 *   ringing (a release, the room's tail) would end in a click; the fade gets there first. Losing focus,
 *   which on Android comes as the app switcher opens, before the page is hidden, silences and fades too.
 * - Coming back: resume on wake, and on any press that finds the audio not running. Android can also
 *   suspend it by itself, so watch for that.
 * - The zombie: a context can report `running` with a dead rendering thread, and `resume()` then does
 *   nothing. Its clock stops, so that's what to watch. The only cure is a new context and new voices.
 */
export interface Clock {
  readonly state: string;
  readonly currentTime: number;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  addEventListener(type: "statechange", fn: () => void): void;
  removeEventListener(type: "statechange", fn: () => void): void;
}

export interface KeeperOptions<G extends { ctx: Clock }> {
  /** Builds a context and its voices. */
  build(): Promise<G>;
  /** Stops every note. */
  silence(): void;
  isVisible(): boolean;
  /** Called whenever the graph changes, so whoever plays through it can follow. */
  onGraph?(graph: G | null): void;
  /**
   * Fades the whole output to nothing, or back up. Without it, going away relies on the release, which
   * suspending can cut off mid-sound.
   */
  mute?(on: boolean): void;
  /** Lets the fade finish before the audio is suspended. */
  suspendAfterMs?: number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(id: unknown): void;
  now?(): number;
}

/** Two ticks without the clock moving is about two seconds, longer than any hiccup seen in testing. */
const STOPPED_TICKS = 2;
export const WATCH_MS = 1000;

export class AudioKeeper<G extends { ctx: Clock }> {
  graph: G | null = null;
  rebuilds = 0;
  /** How long the last wake took to get the clock running. Null until there's been one. */
  lastResumeMs: number | null = null;
  private lastTime = -1;
  private stopped = 0;
  private rebuilding = false;
  private pendingSuspend: unknown = null;
  private muted = false;

  constructor(private opts: KeeperOptions<G>) {}

  private readonly onState = () => {
    if (!this.graph || !this.opts.isVisible()) return;
    const { state } = this.graph.ctx;
    if (state === "suspended" || state === "interrupted") void this.graph.ctx.resume().catch(() => {});
  };

  private adopt(graph: G) {
    this.graph = graph;
    this.lastTime = -1;
    this.stopped = 0;
    graph.ctx.addEventListener("statechange", this.onState);
    this.opts.onGraph?.(graph);
  }

  /** Must be called inside the first tap, so the browser lets the audio start. */
  async start(): Promise<void> {
    this.adopt(await this.opts.build());
  }

  /** On every press that plays, in the touch handler, since that's when a browser allows a resume. */
  pressed(): void {
    // The output stays faded after coming back until something's played, so a tail frozen by the
    // suspend can't sound again on waking.
    if (this.muted) {
      this.muted = false;
      this.opts.mute?.(false);
    }
    const ctx = this.graph?.ctx;
    if (ctx && ctx.state !== "running") void ctx.resume().catch(() => {});
  }

  /** Focus lost while still in view: the app switcher opening, or the notification shade. */
  away(): void {
    this.opts.silence();
    this.muted = true;
    this.opts.mute?.(true);
  }

  hidden(): void {
    this.away();
    this.cancelSuspend();
    const set = this.opts.setTimer ?? setTimeout;
    this.pendingSuspend = set(() => {
      this.pendingSuspend = null;
      if (!this.opts.isVisible()) void this.graph?.ctx.suspend().catch(() => {});
    }, this.opts.suspendAfterMs ?? 250);
  }

  visible(): void {
    this.cancelSuspend();
    this.stopped = 0;
    this.lastTime = -1;
    const ctx = this.graph?.ctx;
    if (!ctx || ctx.state === "running") return;
    const now = this.opts.now ?? (() => performance.now());
    const from = now();
    void ctx.resume().then(() => {
      this.lastResumeMs = Math.round(now() - from);
    }).catch(() => {});
  }

  private cancelSuspend() {
    if (this.pendingSuspend === null) return;
    (this.opts.clearTimer ?? clearTimeout)(this.pendingSuspend as never);
    this.pendingSuspend = null;
  }

  /** Run this every `WATCH_MS` or so. Only a clock that's claimed to be running can be a zombie. */
  tick(): void {
    const ctx = this.graph?.ctx;
    if (!ctx || this.rebuilding || !this.opts.isVisible() || ctx.state !== "running") {
      this.stopped = 0;
      this.lastTime = -1;
      return;
    }
    if (ctx.currentTime === this.lastTime) {
      if (++this.stopped >= STOPPED_TICKS) void this.rebuild();
    } else {
      this.stopped = 0;
      this.lastTime = ctx.currentTime;
    }
  }

  private async rebuild(): Promise<void> {
    const old = this.graph;
    if (!old || this.rebuilding) return;
    this.rebuilding = true;
    this.rebuilds++;
    this.opts.silence();
    this.muted = false; // a new graph starts at full level
    this.graph = null;
    this.opts.onGraph?.(null);
    old.ctx.removeEventListener("statechange", this.onState);
    await old.ctx.close().catch(() => {}); // frees its WASM memories before new ones are made
    try {
      this.adopt(await this.opts.build());
    } finally {
      this.rebuilding = false;
    }
  }
}
