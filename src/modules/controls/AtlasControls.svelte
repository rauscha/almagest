<script lang="ts">
  // The top of the left column in the star atlas: a small Menu, the voicing slider, and the next
  // chords, led by the same ranked stars as the circle so the two read as one chart.
  import type { ModuleProps, Spread } from "../../core/contract";

  let { view, send }: ModuleProps<"controls"> = $props();

  // The same magnitude as the circle's stars: brighter and larger for a stronger connection.
  const FAINT = [0x5c, 0x67, 0x82], CHALK = [0xef, 0xec, 0xe3];
  const strength = (p: number) => Math.min(1, Math.max(0.12, Math.sqrt(p / 0.6)));
  const starR = (p: number) => 2 + 6 * strength(p);
  const starFill = (p: number) => `rgb(${FAINT.map((f, i) => Math.round(f + (CHALK[i] - f) * strength(p))).join(",")})`;
  const word = (s: string) => s[0].toUpperCase() + s.slice(1);
  const presetName = $derived($view.presets.find((p) => p.id === $view.preset)?.name ?? "Off");

  // Voicing slider: three dots packed at Close, spread at Wide; a touch picks the nearest stop.
  const TRACK = { from: 22, to: 118, y: 14 };
  const stopX = (i: number, n: number) => TRACK.from + ((TRACK.to - TRACK.from) * i) / Math.max(1, n - 1);
  const at = $derived(Math.max(0, $view.spreads.indexOf($view.spread)));
  let box = $state<SVGSVGElement>();
  let dragging: number | null = null;
  function pick(e: PointerEvent) {
    if (!box) return;
    const r = box.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 132;
    const n = $view.spreads.length;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(stopX(i, n) - x) < Math.abs(stopX(best, n) - x)) best = i;
    const spread: Spread = $view.spreads[best];
    if (spread !== $view.spread) send({ type: "spreadChanged", spread });
  }
  const down = (e: PointerEvent) => { dragging = e.pointerId; box?.setPointerCapture(e.pointerId); pick(e); };
  const move = (e: PointerEvent) => { if (e.pointerId === dragging) pick(e); };
  const up = (e: PointerEvent) => { if (e.pointerId === dragging) dragging = null; };
  function key(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    const spread = $view.spreads[at + step];
    if (!step || !spread) return;
    e.preventDefault();
    send({ type: "spreadChanged", spread });
  }
  const estimated = $derived($view.next.some((n) => !n.measured));
  const pct = (p: number) => `${Math.round(p * 100)}%`;
</script>

<div class="left">
  <div class="top">
    <button class="menu" class:on={$view.menuOpen} onclick={() => send({ type: "menuToggled" })} aria-label="Menu">
      <svg viewBox="0 0 16 12" aria-hidden="true"><line x1="0" y1="1" x2="16" y2="1" /><line x1="0" y1="6" x2="16" y2="6" /><line x1="0" y1="11" x2="16" y2="11" /></svg>
      Menu
    </button>
    <div class="voicing">
      <div class="vcap"><span class="cap">VOICING</span><span class="vword" data-spread-now={$view.spread}>{word($view.spread)}</span></div>
      <svg
        bind:this={box} class="slider" viewBox="0 0 132 28" role="slider" tabindex="0" aria-label="Voicing"
        aria-valuemin={0} aria-valuemax={$view.spreads.length - 1} aria-valuenow={at} aria-valuetext={$view.spread}
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}
      >
        <rect class="hit" x="0" y="0" width="132" height="28" />
        {#each [-3, 0, 3] as dx (dx)}<circle class="dot" cx={8 + dx} cy={TRACK.y} r="1.5" />{/each}
        {#each [-8, 0, 8] as dx (dx)}<circle class="dot" cx={125 + dx * 0.9} cy={TRACK.y} r="1.5" />{/each}
        <line class="track" x1={TRACK.from} y1={TRACK.y} x2={TRACK.to} y2={TRACK.y} />
        {#each $view.spreads as s, i (s)}
          <line class="tick" x1={stopX(i, $view.spreads.length)} y1={TRACK.y - 3} x2={stopX(i, $view.spreads.length)} y2={TRACK.y + 3} />
        {/each}
        <!-- The chosen stop wears a ring: engaged. -->
        <circle class="thumb" cx={stopX(at, $view.spreads.length)} cy={TRACK.y} r="10" />
        {#each [-3.5, 0, 3.5] as dx (dx)}<circle class="thumb-dot" cx={stopX(at, $view.spreads.length) + dx} cy={TRACK.y} r="1.4" />{/each}
        {#each $view.spreads as s, i (s)}
          <rect class="hit" data-stop={s} x={stopX(i, $view.spreads.length) - 14} y="0" width="28" height="28" />
        {/each}
      </svg>
    </div>
  </div>

  <div class="section"><span class="cap">NEXT · {presetName.toUpperCase()}</span><span class="hair"></span></div>
  {#if $view.next.length}
    <div class="head-row"><span></span><span></span><span></span><span class="h">odds</span><span class="h">moves</span></div>
    {#each $view.next as n, i (n.name + i)}
      <div class="row" data-rank={i + 1}>
        <svg class="star" viewBox="-8 -8 16 16" aria-hidden="true"><circle r={starR(n.p)} style={`fill: ${starFill(n.p)}`} /></svg>
        <span class="name">{n.name}</span>
        <span class="num">{n.numeral}</span>
        <span class="val">{n.measured ? "" : "~"}{pct(n.p)}</span>
        <span class="val">{n.cost} st</span>
      </div>
    {/each}
    {#if estimated}<div class="foot">~ estimated, not measured</div>{/if}
  {:else}
    <div class="empty">{$view.preset ? "Play a chord; where it can go shows here." : "Next chords are off. Turn them on in the Menu."}</div>
  {/if}
</div>

<style>
  .left { height: 100%; color: var(--ink); font-family: var(--font-serif); }
  .top { display: flex; gap: 18px; align-items: flex-start; }
  .menu {
    all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 10px;
    border: 1px solid var(--rule-2); font: 400 13px var(--font-text); color: var(--ink); white-space: nowrap;
  }
  .menu svg { width: 14px; height: 11px; }
  .menu svg line { stroke: var(--ink); stroke-width: 1.4; }
  .menu.on { background: var(--ink); color: var(--ground); border-color: var(--ink); }
  .menu.on svg line { stroke: var(--ground); }
  .voicing { flex: 1; min-width: 0; }
  .vcap { display: flex; justify-content: space-between; align-items: baseline; height: 14px; }
  .cap { font: 500 9px var(--font-caps); letter-spacing: 0.14em; color: var(--lamp); white-space: nowrap; }
  .vword { font-style: italic; font-size: 14px; color: var(--ink); }
  .slider { display: block; width: 100%; height: 28px; touch-action: none; }
  .hit { fill: transparent; }
  .dot { fill: var(--ink-3); }
  .track { stroke: var(--rule-2); stroke-width: 1; }
  .tick { stroke: var(--faint); stroke-width: 1; }
  .thumb { fill: var(--ground); stroke: var(--ink); stroke-width: 1.6; }
  .thumb-dot { fill: var(--ink); }
  .section { display: flex; align-items: center; gap: 8px; margin-top: 14px; }
  .hair { flex: 1; height: 1px; background: var(--rule-2); }
  .head-row, .row { display: grid; grid-template-columns: 18px minmax(0, 1fr) 36px 44px 40px; align-items: baseline; column-gap: 4px; }
  .head-row { margin-top: 6px; }
  .h { font: 400 11px var(--font-text); color: var(--ink-3); text-align: right; white-space: nowrap; }
  .row { height: 27px; }
  .star { width: 16px; height: 16px; align-self: center; }
  .star circle { fill: var(--ink); }
  .name { font-style: italic; font-size: 19px; line-height: 1; white-space: nowrap; overflow: hidden; }
  .num { font-size: 15px; color: var(--ink); white-space: nowrap; }
  .val { font: 400 14px var(--font-text); font-variant-numeric: lining-nums tabular-nums; color: var(--ink); text-align: right; white-space: nowrap; }
  .foot, .empty { font: 400 12px var(--font-text); color: var(--ink-3); margin-top: 4px; white-space: nowrap; }
  .empty { margin-top: 12px; font: italic 12.5px var(--font-serif); color: var(--ink-2); }
</style>
