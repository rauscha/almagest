import { describe, expect, it } from "vitest";
import { AudioKeeper, type Clock } from "./keeper";

class FakeClock implements Clock {
  state = "running";
  currentTime = 0;
  log: string[] = [];
  private fn: (() => void) | null = null;
  async resume() {
    this.log.push("resume");
    this.state = "running";
  }
  async suspend() {
    this.log.push("suspend");
    this.state = "suspended";
  }
  async close() {
    this.log.push("close");
    this.state = "closed";
  }
  addEventListener(_: "statechange", fn: () => void) {
    this.fn = fn;
  }
  removeEventListener() {
    this.fn = null;
  }
  androidSuspends() {
    this.state = "suspended";
    this.fn?.();
  }
}

function rig() {
  const built: FakeClock[] = [];
  const log: string[] = [];
  const timers: (() => void)[] = [];
  let visible = true;
  const keeper = new AudioKeeper({
    build: async () => {
      const ctx = new FakeClock();
      built.push(ctx);
      return { ctx };
    },
    silence: () => log.push("silence"),
    mute: (on) => log.push(on ? "mute" : "unmute"),
    isVisible: () => visible,
    setTimer: (fn) => timers.push(fn) - 1,
    clearTimer: (id) => {
      timers[id as number] = () => {};
    },
    now: () => 0,
  });
  return {
    keeper, built, log, timers,
    setVisible: (v: boolean) => { visible = v; },
    runTimers: () => timers.splice(0).forEach((t) => t()),
    settled: () => new Promise((r) => setTimeout(r)),
  };
}

describe("the audio keeper", () => {
  it("going away silences first, then suspends", async () => {
    const r = rig();
    await r.keeper.start();
    r.setVisible(false);
    r.keeper.hidden();
    expect(r.log).toEqual(["silence", "mute"]);
    expect(r.built[0].log).toEqual([]); // the fade gets to finish
    r.runTimers();
    expect(r.built[0].log).toEqual(["suspend"]);
  });
  it("after coming back, the output stays faded until something plays", async () => {
    const r = rig();
    await r.keeper.start();
    r.setVisible(false);
    r.keeper.hidden();
    r.runTimers();
    r.setVisible(true);
    r.keeper.visible();
    expect(r.log).toEqual(["silence", "mute"]);
    r.keeper.pressed();
    r.keeper.pressed();
    expect(r.log).toEqual(["silence", "mute", "unmute"]);
  });
  it("losing focus while in view silences and fades, but doesn't suspend", async () => {
    const r = rig();
    await r.keeper.start();
    r.keeper.away();
    expect(r.log).toEqual(["silence", "mute"]);
    expect(r.timers).toHaveLength(0);
    r.keeper.pressed();
    expect(r.log).toEqual(["silence", "mute", "unmute"]);
  });
  it("a rebuilt graph starts at full level, so the next press needn't unmute it", async () => {
    const r = rig();
    await r.keeper.start();
    r.keeper.away();
    r.built[0].currentTime = 5;
    r.keeper.tick();
    r.keeper.tick();
    r.keeper.tick();
    await r.settled();
    expect(r.built).toHaveLength(2);
    r.keeper.pressed();
    expect(r.log.filter((l) => l === "unmute")).toHaveLength(0);
  });
  it("coming straight back cancels the suspend", async () => {
    const r = rig();
    await r.keeper.start();
    r.setVisible(false);
    r.keeper.hidden();
    r.setVisible(true);
    r.keeper.visible();
    r.runTimers();
    expect(r.built[0].log).toEqual([]);
  });
  it("coming back resumes", async () => {
    const r = rig();
    await r.keeper.start();
    r.setVisible(false);
    r.keeper.hidden();
    r.runTimers();
    r.setVisible(true);
    r.keeper.visible();
    expect(r.built[0].log).toEqual(["suspend", "resume"]);
  });
  it("a press that finds the audio stopped resumes it, and otherwise does nothing", async () => {
    const r = rig();
    await r.keeper.start();
    r.keeper.pressed();
    expect(r.built[0].log).toEqual([]);
    r.built[0].state = "suspended";
    r.keeper.pressed();
    expect(r.built[0].log).toEqual(["resume"]);
  });
  it("if Android suspends it while visible, it's resumed", async () => {
    const r = rig();
    await r.keeper.start();
    r.built[0].androidSuspends();
    expect(r.built[0].log).toEqual(["resume"]);
  });
  it("while hidden, Android suspending it is left alone", async () => {
    const r = rig();
    await r.keeper.start();
    r.setVisible(false);
    r.built[0].androidSuspends();
    expect(r.built[0].log).toEqual([]);
  });

  describe("the zombie", () => {
    const alive = async () => {
      const r = rig();
      await r.keeper.start();
      return r;
    };
    it("a clock that moves is left alone", async () => {
      const r = await alive();
      for (let i = 0; i < 10; i++) {
        r.built[0].currentTime += 1;
        r.keeper.tick();
      }
      expect(r.keeper.rebuilds).toBe(0);
    });
    it("a running clock that's stopped gets a new context and new voices", async () => {
      const r = await alive();
      for (let i = 0; i < 4; i++) r.keeper.tick();
      await r.settled();
      expect(r.keeper.rebuilds).toBe(1);
      expect(r.built).toHaveLength(2);
      expect(r.built[0].log).toEqual(["close"]);
      expect(r.keeper.graph?.ctx).toBe(r.built[1]);
      expect(r.log).toEqual(["silence"]);
    });
    it("one missed tick isn't a zombie", async () => {
      const r = await alive();
      r.keeper.tick();
      r.keeper.tick(); // the same time as the tick before, once
      r.built[0].currentTime += 1;
      r.keeper.tick();
      r.keeper.tick();
      await r.settled();
      expect(r.keeper.rebuilds).toBe(0);
    });
    it("a suspended clock isn't a zombie, even though it's stopped", async () => {
      const r = await alive();
      r.built[0].state = "suspended";
      for (let i = 0; i < 5; i++) r.keeper.tick();
      expect(r.keeper.rebuilds).toBe(0);
    });
    it("nothing is judged while hidden, or on the first ticks after a wake", async () => {
      const r = await alive();
      r.setVisible(false);
      for (let i = 0; i < 5; i++) r.keeper.tick();
      expect(r.keeper.rebuilds).toBe(0);
      r.setVisible(true);
      r.keeper.visible();
      r.keeper.tick();
      r.keeper.tick();
      expect(r.keeper.rebuilds).toBe(0);
    });
    it("rebuilds once, however many ticks arrive meanwhile", async () => {
      const r = await alive();
      for (let i = 0; i < 12; i++) r.keeper.tick();
      await r.settled();
      expect(r.built).toHaveLength(2);
    });
    it("tells whoever's playing that the graph changed", async () => {
      const seen: unknown[] = [];
      const made: FakeClock[] = [];
      const keeper = new AudioKeeper({
        build: async () => {
          const ctx = new FakeClock();
          made.push(ctx);
          return { ctx };
        },
        silence: () => {},
        isVisible: () => true,
        onGraph: (g) => seen.push(g?.ctx ?? null),
      });
      await keeper.start();
      for (let i = 0; i < 3; i++) keeper.tick();
      await new Promise((r) => setTimeout(r));
      expect(seen).toEqual([made[0], null, made[1]]);
    });
  });
});
