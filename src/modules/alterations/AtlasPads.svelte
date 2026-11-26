<script lang="ts">
  import type { Alteration, ModuleProps } from "../../core/contract";

  let { view, send }: ModuleProps<"alterations"> = $props();
  const LABEL: Partial<Record<Alteration, string>> = { major: "Major", minor: "Minor" };
  const fingers = new Set<number>();
  // Native keyboard and assistive activation arrives as a click without pointer input.
  function activate(e: MouseEvent, pad: Alteration) {
    if (e.detail !== 0) return;
    send({ type: "padDown", pad, pointer: -2 });
    send({ type: "padUp", pointer: -2 });
  }
  function down(e: PointerEvent, pad: Alteration) {
    if (e.button !== 0) return;
    fingers.add(e.pointerId);
    send({ type: "padDown", pad, pointer: e.pointerId });
  }
  function up(e: PointerEvent) {
    if (fingers.delete(e.pointerId)) send({ type: "padUp", pointer: e.pointerId });
  }
</script>

<svelte:window onpointerup={up} onpointercancel={up} />

<div class="wrap">
  <div class="section">
    <span class="cap">Alter <span class:chord-name={!!$view.chordName}>{$view.chordName || "chord"}</span></span>
    <button class="auto" aria-label="Auto 7ths" aria-pressed={$view.sevenInKey}
      aria-describedby="auto-explanation"
      onclick={() => send({ type: "sevenInKeyToggled" })}>
      <span class="auto-copy">Auto 7ths
        {#if $view.sevenInKey && $view.sevenChord}<small>{$view.sevenChord}</small>{/if}
      </span><span class="switch">{$view.sevenInKey ? "On" : "Off"}</span>
    </button>
    <span hidden id="auto-explanation">Give each chord its own seventh in the key. {$view.sevenChord}</span>
  </div>
  <div class="pads">
    {#each $view.options as o (o.id)}
      {@const label = LABEL[o.id] ?? o.id}
      {@const temporary = o.on && !o.latched && !o.held}
      <button class="pad" class:shaded={o.inKey !== false} class:engaged={o.latched} class:held={o.held}
        disabled={!o.available} aria-pressed={o.latched} data-latched={o.latched}
        aria-label={label} aria-describedby={`pad-result-${o.id} pad-scope-${o.id}`}
        onpointerdown={(e) => down(e, o.id)} onclick={(e) => activate(e, o.id)}
        onkeydown={(e) => { if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault(); }}>
        <span class="label"><span class="ring">{label}</span></span>
        <span class="scope" id={`pad-scope-${o.id}`}>{temporary ? "this chord" : o.latched && !o.held ? "latched" : ""}</span>
        <span class="chord" id={`pad-result-${o.id}`}>{o.available ? o.chord : "—"}{#if o.inKey === false}<span class="out">out</span>{/if}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .wrap { height: 100%; display: flex; flex-direction: column; color: var(--ink); font-family: var(--font-serif); }
  .section { height: 34px; display: flex; align-items: center; justify-content: space-between; gap: 4px; }
  .cap { font: 500 10px var(--font-caps); text-transform: uppercase; letter-spacing: .08em; color: var(--lamp); }
  .chord-name { text-transform: none; }
  .auto-copy { text-align: left; line-height: 1; }
  .auto-copy small { display: block; margin-top: 2px; color: var(--ink-2); font: italic 11px/1 var(--font-text); }
  .auto { display: flex; align-items: center; gap: 5px; height: 100%; padding: 0 2px; color: var(--ink); border: 0; background: transparent; font: 14px var(--font-serif); }
  .switch { min-width: 24px; padding: 1px 3px; border: 1px solid var(--rule-2); border-radius: 12px; font: 11px var(--font-text); }
  .auto[aria-pressed=true] .switch { background: var(--ink); color: var(--ground); }
  .pads { flex: 1; min-height: 0; display: grid; grid-template: repeat(4, 1fr) / repeat(2, 1fr); }
  .pad { all: unset; box-sizing: border-box; position: relative; min-width: 0; touch-action: none; border: 1px solid var(--rule-2); }
  .pad:nth-child(even) { border-left: 0; }
  .pad:nth-child(3), .pad:nth-child(4) { border-top: 0; }
  .pad:nth-child(n+5) { margin-top: 3px; }
  .pad.shaded { background: var(--chart-lo); }
  .label, .chord { position: absolute; left: 8px; right: 2px; white-space: nowrap; }
  .label { top: 5px; line-height: 1; }
  .ring { display: inline-block; padding: 1px 4px 2px; border: 1px solid transparent; border-radius: 12px; font-size: 20px; }
  .chord { bottom: 4px; left: 13px; font: italic 12px var(--font-text); color: var(--ink-2); }
  .out { margin-left: .35em; font-style: normal; color: var(--lamp); }
  .scope { position: absolute; top: 3px; right: 4px; font: 10px var(--font-text); color: var(--ink); }
  .pad.engaged .ring { border-color: var(--ink); }
  .pad:disabled, .pad:disabled .chord { color: var(--ink-3); }
  .pad.held { background: var(--ink); color: var(--ground); }
  .pad.held .chord, .pad.held .out { color: var(--ground); }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: -3px; }
</style>
