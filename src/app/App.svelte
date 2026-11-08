<script lang="ts">
  // Layout A: pads under the left thumb, the roll in the middle, the circle under the right.
  import type { ReadableAtom } from "nanostores";
  import type { Core } from "../core/core";
  import type { Box, Modules } from "../skins/skins";
  import type { Slot } from "../core/contract";
  import { enterFullscreen } from "./install";

  let { core, look, start }: {
    core: Core;
    /** The look being worn: its modules, and where it puts each slot. The Menu can swap it. */
    look: ReadableAtom<{ modules: Modules; slots?: Partial<Record<Slot, Box>> }>;
    start: () => Promise<void>;
  } = $props();
  const active = $derived($look.modules);

  const W = 998;
  const H = 448;
  const DEFAULT_SLOTS: Record<Slot, Box> = {
    practice: [24, 8, 240, 0], // not built yet, so it takes no room
    controls: [24, 8, 240, 140],
    alterations: [24, 152, 240, 288],
    // Narrow: past chords only need to show where the voices went, not hold their width.
    readout: [278, 6, 252, 48],
    ribbon: [278, 58, 252, 384],
    circle: [534, 4, 440, 440],
    // Over the ribbon when it's open, so pads and chords can still be played while choosing a sound.
    menu: [278, 6, 252, 436],
  };
  const slots = $derived(Object.entries({ ...DEFAULT_SLOTS, ...$look.slots }) as [Slot, Box][]);

  let scale = $state(1);
  const fit = () => {
    scale = Math.min(innerWidth / W, innerHeight / H);
  };
  $effect(fit);

  let phase = $state<"idle" | "loading" | "ready" | "failed">("idle");
  let problem = $state("");
  let enteredOnce = false;

  async function begin() {
    phase = "loading";
    if (!enteredOnce) {
      enteredOnce = true;
      void enterFullscreen(); // once a session at most, and never when installed
    }
    try {
      await start();
      phase = "ready";
    } catch (err) {
      problem = String(err);
      phase = "failed";
    }
  }
</script>

<svelte:window onresize={fit} oncontextmenu={(e) => e.preventDefault()} />

<div class="turn">Turn the phone sideways.</div>

<div class="stage" style="transform: translate(-50%, -50%) scale({scale})">
  {#each slots as [slot, [x, y, w, h]] (slot)}
    {@const Module = active[slot]}
    <div class="slot" class:overlay={slot === "menu"} data-slot={slot} style="left:{x}px;top:{y}px;width:{w}px;height:{h}px;{h ? '' : 'overflow:hidden'}">
      <Module view={core.views[slot]} send={core.send} />
    </div>
  {/each}
</div>

{#if phase !== "ready"}
  <button class="start" disabled={phase === "loading"} onclick={begin}>
    {#if phase === "idle"}Tap to start{:else if phase === "loading"}Loading the voices…{:else}Couldn't start the sound. Tap to retry.<br />{problem}{/if}
  </button>
{/if}

<style>
  .stage { position: absolute; left: 50%; top: 50%; width: 998px; height: 448px; transform-origin: center; font-variant-numeric: lining-nums; }
  .slot { position: absolute; }
  .slot.overlay { z-index: 5; pointer-events: none; }
  .start {
    all: unset; position: fixed; inset: 0; z-index: 10; display: grid; place-content: center; text-align: center;
    background: var(--ground); color: var(--ink); font: 700 30px var(--font-display); letter-spacing: -0.02em;
  }
  .start:disabled { font-weight: 600; font-size: 18px; color: var(--ink-2); }
  .turn {
    display: none; position: fixed; inset: 0; z-index: 20; place-items: center;
    background: var(--ground); color: var(--ink); font: 500 16px var(--font-text);
  }
  @media (orientation: portrait) { .turn { display: grid; } }
</style>
