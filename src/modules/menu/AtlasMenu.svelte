<script lang="ts">
  // Settings in the star atlas. It opens over the middle column, so the pads and the circle stay
  // playable. Each group is one frame with shared dividers, nothing wraps, and it fits without
  // scrolling. Next chords moved here from the main screen.
  import type { ModuleProps } from "../../core/contract";

  let { view, send }: ModuleProps<"menu"> = $props();

  const ringLabel = (ms: number) => (ms === 0 ? "Off" : `${ms / 1000}`);
  const SHORT: Record<string, string> = { "Classic Waveshapes + Filter": "Classic + Filter" };
  function slideAt(ms: number) {
    send({ type: "slideTimeChanged", ms });
    if (!$view.slide) send({ type: "slideToggled" });
  }
</script>

<div class="host">
  {#if $view.open}
    <div class="menu">
      <div class="seg">
        {#each $view.engines as e (e.id)}
          <button class:on={e.id === $view.engine} onclick={() => send({ type: "engineChanged", engine: e.id })}>{e.label}</button>
        {/each}
      </div>

      <div class="sounds">
        {#each $view.models as name, i (name)}
          <button class="sound" class:on={i === $view.model} aria-label={name} onclick={() => send({ type: "modelChanged", model: i })}>{SHORT[name] ?? name}</button>
        {/each}
      </div>

      <div class="group">
        <div class="cap">NEXT CHORDS</div>
        <div class="seg">
          {#each $view.presets as p (p.id)}
            <button class:on={p.id === $view.preset} onclick={() => send({ type: "presetChanged", preset: p.id })}>{p.short}</button>
          {/each}
          <button class:on={$view.preset === null} onclick={() => send({ type: "presetChanged", preset: null })}>Off</button>
        </div>
      </div>

      <div class="group">
        <div class="cap">SHAPE · DRAW ONE ON THE CIRCLE</div>
        <div class="seg">
          <button class="shape" class:on={$view.shape === null} onclick={() => send({ type: "shapeChosen", shape: null })}>Off</button>
          {#each $view.shapes as s (s.id)}
            <button class="shape" class:on={s.id === $view.shape} data-shape={s.id} onclick={() => send({ type: "shapeChosen", shape: s.id })}>{s.label}</button>
          {/each}
        </div>
      </div>

      <!-- Whether a loaded shape asks for its 7ths and add9s (ii7–V7–Imaj7) or plain chords. -->
      <div class="group">
        <div class="cap">SHAPE CHORDS</div>
        <div class="seg">
          <button class:on={!$view.colored} onclick={() => send({ type: "shapeColored", colored: false })}>Plain</button>
          <button class="colored" class:on={$view.colored} onclick={() => send({ type: "shapeColored", colored: true })}>With 7ths and add9s</button>
        </div>
      </div>

      <div class="group">
        <div class="cap">MOVING VOICES · SLIDE TIME, MS</div>
        <div class="seg">
          <button class="restrike" class:on={!$view.slide} onclick={() => $view.slide && send({ type: "slideToggled" })}>Re-strike</button>
          {#each $view.slideChoices as ms (ms)}
            <button class="fig" class:on={$view.slide && ms === $view.slideMs} onclick={() => slideAt(ms)}>{ms}</button>
          {/each}
        </div>
      </div>

      <!-- Two short rows share a line, which leaves room for the shapes. -->
      <div class="pair">
        <div class="group space">
          <div class="cap">SPACE</div>
          <div class="seg">
            {#each $view.spaces as space (space)}
              <button class:on={space === $view.space} onclick={() => send({ type: "spaceChanged", space })}>{space[0].toUpperCase() + space.slice(1)}</button>
            {/each}
          </div>
        </div>
        <div class="group ring">
          <div class="cap">RING AFTER LIFT, S</div>
          <div class="seg">
            {#each $view.ringChoices as ms (ms)}
              <button class="fig" class:on={ms === $view.ringMs} onclick={() => send({ type: "ringChanged", ms })}>{ringLabel(ms)}</button>
            {/each}
          </div>
        </div>
      </div>

      <div class="actions">
        <button class="act" onclick={() => send({ type: "trailCleared" })}>Clear trail</button>
        <button class="act done" onclick={() => send({ type: "menuToggled" })}>Done</button>
      </div>
      <div class="about">{$view.about}</div>
    </div>
  {/if}
</div>

<style>
  .host { width: 100%; height: 100%; }
  .menu {
    pointer-events: auto; height: 100%; box-sizing: border-box; padding: 8px; display: flex; flex-direction: column; gap: 5px;
    overflow: hidden; background: var(--ground); border: 1px solid var(--rule-2); font-family: var(--font-serif); color: var(--ink);
  }
  .group { display: flex; flex-direction: column; gap: 2px; }
  .pair { display: flex; gap: 8px; }
  .pair > .group { min-width: 0; }
  .space { flex: 3 1 0; }
  .ring { flex: 4 1 0; }
  button {
    all: unset; flex: 1 1 0; min-width: 0; height: 24px; text-align: center; box-sizing: border-box;
    font: 400 13px/24px var(--font-serif); color: var(--ink); white-space: nowrap; overflow: hidden;
  }
  button.fig { font: 400 11px/24px var(--font-text); }
  button:disabled { color: var(--ink-3); }
  button.on { background: var(--ink); color: var(--ground); }
  .seg, .sounds { border: 1px solid var(--rule-2); overflow: hidden; }
  .seg { display: flex; flex: none; }
  .seg > button + button { border-left: 1px solid var(--rule-2); }
  .restrike { flex-grow: 1.7; }
  .colored { flex-grow: 2.4; }
  /* The shapes' names differ in length, so each takes what it needs and the rest is shared. */
  .seg > .shape { flex: 1 1 auto; padding: 0 5px; }
  .sounds { display: grid; grid-template-columns: 1fr 1fr; flex: none; }
  .sound { height: 21px; font-size: 12px; line-height: 21px; font-style: italic; padding: 0 4px; border-bottom: 1px solid var(--rule); }
  .sound:nth-child(odd) { border-right: 1px solid var(--rule); }
  .sound:last-child:nth-child(odd) { grid-column: span 2; border-right: none; }
  .sound:last-child, .sound:nth-last-child(2):nth-child(odd) { border-bottom: none; }
  .cap { font: 500 9px/11px var(--font-text); letter-spacing: 0.14em; color: var(--lamp); white-space: nowrap; }
  .actions { margin-top: auto; display: flex; gap: 6px; }
  .act { height: 24px; border: 1px solid var(--rule-2); font-size: 12.5px; line-height: 22px; }
  .done { flex: 0 0 64px; }
  .about { font: 400 8.5px/1.2 var(--font-text); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
