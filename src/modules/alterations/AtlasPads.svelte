<script lang="ts">
  // The pads in the star atlas. One grid with shared lines. Shaded ground keeps you in the key;
  // unshaded ground plus the word "out" leaves it (line style is kept for function alone). A ring means
  // engaged: latched or applied to the sounding chord. A pad under the finger fills solid.
  import type { Alteration, ModuleProps } from "../../core/contract";

  let { view, send }: ModuleProps<"alterations"> = $props();

  const LABEL: Partial<Record<Alteration, string>> = { major: "Major", minor: "Minor" };

  const mine = new Set<number>();
  function down(e: PointerEvent, pad: Alteration) {
    mine.add(e.pointerId);
    send({ type: "padDown", pad, pointer: e.pointerId });
  }
  function up(e: PointerEvent) {
    if (mine.delete(e.pointerId)) send({ type: "padUp", pointer: e.pointerId });
  }
</script>

<svelte:window onpointerup={up} onpointercancel={up} />

<div class="wrap">
  <div class="section"><span class="cap">{$view.chordName ? `ON ${$view.chordName}` : "ALTER"}</span><span class="hair"></span></div>
  <div class="pads">
    {#each $view.options as o (o.id)}
      <button
        class="pad"
        class:shaded={o.inKey !== false}
        class:engaged={o.on || o.latched}
        class:held={o.held}
        disabled={!o.available}
        aria-pressed={o.on || o.latched}
        data-latched={o.latched}
        onpointerdown={(e) => down(e, o.id)}
      >
        <span class="label" class:word={!!LABEL[o.id]}><span class="ring">{LABEL[o.id] ?? o.id}</span></span>
        <span class="chord">{o.available ? o.chord : "—"}{#if o.inKey === false}<span class="out">out</span>{/if}</span>
      </button>
    {/each}
    <button class="pad shaded sustain" class:engaged={$view.sustain} aria-pressed={$view.sustain} onclick={() => send({ type: "sustainToggled" })}>
      <span class="label word"><span class="ring">Sustain</span></span>
      <span class="chord">{$view.sustain ? "on" : "off"}</span>
    </button>
  </div>
</div>

<style>
  .wrap { height: 100%; display: flex; flex-direction: column; font-family: var(--font-serif); }
  .section { display: flex; align-items: center; gap: 8px; height: 14px; margin-bottom: 8px; }
  .cap { font: 500 9px var(--font-text); letter-spacing: 0.14em; color: var(--lamp); white-space: nowrap; }
  .hair { flex: 1; height: 1px; background: var(--rule-2); }
  .pads {
    flex: 1; min-height: 0; display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr);
    border: 1px solid var(--rule-2); background: var(--ground);
  }
  .pad {
    all: unset; position: relative; box-sizing: border-box; min-width: 0; min-height: 0; color: var(--ink); touch-action: none;
    border-right: 1px solid var(--rule-2); border-bottom: 1px solid var(--rule-2);
  }
  .pad:nth-child(3n) { border-right: none; }
  .pad:nth-child(n + 7) { border-bottom: none; }
  .pad.shaded { background: var(--chart-lo); }
  /* Pinned in place, whatever appears beneath. */
  .label { position: absolute; left: 0; right: 0; top: 42%; transform: translateY(-50%); text-align: center; white-space: nowrap; }
  .ring { display: inline-block; font-size: 25px; line-height: 1; padding: 4px 9px 6px; border: 1.6px solid transparent; border-radius: 999px; }
  .word .ring { font-size: 17px; padding: 3px 7px 4px; }
  .chord {
    position: absolute; left: 0; right: 0; top: calc(42% + 20px); text-align: center; white-space: nowrap;
    font: 400 9.5px var(--font-text); color: var(--ink-2);
  }
  .out { color: var(--lamp); margin-left: 0.6em; }
  .pad.engaged .ring { border-color: var(--ink); }
  .pad:disabled { color: var(--ink-3); }
  .pad:disabled .chord { color: var(--ink-3); }
  .pad.held { background: var(--ink); color: var(--ground); }
  .pad.held .chord, .pad.held .out { color: var(--ground); }
  .pad.held .ring { border-color: var(--ground); }
</style>
