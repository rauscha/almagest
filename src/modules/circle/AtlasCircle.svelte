<script lang="ts">
  // The circle as a night sky chart. The key is a lit region,
  // chords are named stars, the likely next chords are brighter stars on a fixed three-step ramp, and the
  // trail is a constellation. One meaning per mark: size is likelihood, a ring is engaged, line style is
  // function. After a long press, the chord that leads to the one held wears a dotted ring (dotted is
  // tension, as in the function arcs) and the words "leads here", and is named as the 7th it plays. The hub is the key dial. Touch areas are the shared ones, so this plays like every circle.
  import type { ChordRef, CircleChord, Fn, ModuleProps } from "../../core/contract";
  import { cellPath, pol, RING, touches, xy } from "./geometry";

  let { view, send }: ModuleProps<"circle"> = $props();
  let svg = $state<SVGSVGElement>();
  const { down, report } = touches((i) => send(i), () => svg);

  /**
   * A star's magnitude, as on a sky chart: brighter and larger for a stronger connection: how
   * strongly chords connect matters more than the exact percent. Every
   * chord the counts give gets one. The scale is absolute, so 30% looks the same from any chord.
   */
  const FAINT = [0x5c, 0x67, 0x82], CHALK = [0xef, 0xec, 0xe3];
  const strength = (p: number) => Math.min(1, Math.max(0.12, Math.sqrt(p / 0.6)));
  const starR = (p: number) => 2 + 6 * strength(p);
  const starFill = (p: number) => {
    const t = strength(p);
    return `rgb(${FAINT.map((f, i) => Math.round(f + (CHALK[i] - f) * t)).join(",")})`;
  };
  /** The magnitude scale drawn in the corner, beside what it explains. */
  const SCALE = [0.6, 0.3, 0.1, 0.03];
  const TRAIL_STAR = 2.4;
  const HUB = 46;
  const ANCHOR = { maj: RING.maj.c, min: RING.min.c, dim: RING.dim.c - 2 };
  const SIZE = {
    maj: { num: 23, name: 11.5, numY: 2, nameY: 16, out: 12.5 },
    min: { num: 18, name: 10.5, numY: 1, nameY: 13.5, out: 11.5 },
    dim: { num: 13, name: 9.5, numY: 0.5, nameY: 11.5, out: 10 },
  };
  /** Line style is function and nothing else: solid home, dashed away, dotted tension. */
  const DASH: Record<Exclude<Fn, "both">, string> = { tonic: "none", subdominant: "5 3.2", dominant: "0.1 3.4" };
  const SLIT = { maj: { r: RING.maj.o - 6, span: 8 }, min: { r: RING.min.o - 5, span: 10.5 }, dim: { r: RING.dim.o - 4, span: 9 } };

  const same = (a: ChordRef | null | undefined, b: ChordRef) => !!a && a.ring === b.ring && a.col === b.col;
  const keyOf = (r: ChordRef) => `${r.ring}-${r.col}`;
  const at = (r: ChordRef): [number, number] => pol(ANCHOR[r.ring], r.col * 30);
  const arc = (r: number, a1: number, a2: number) => `M${xy(pol(r, a1))}A${r} ${r} 0 0 1 ${xy(pol(r, a2))}`;
  /** Roughly how wide a numeral sets, so a star can sit just left of it. */
  const numWidth = (c: CircleChord) => c.numeral.length * (c.ref.ring === "maj" ? 8.5 : c.ref.ring === "min" ? 6.4 : 5);
  const nameWidth = (c: CircleChord) => c.name.length * (c.ref.ring === "maj" ? 6.6 : 6);

  const chordAt = (r: ChordRef) => $view.chords.find((c) => same(c.ref, r));
  const rankOf = $derived(new Map($view.next.map((n, i) => [keyOf(n.ref), i])));
  const pOf = $derived(new Map($view.next.map((n) => [keyOf(n.ref), n.p])));
  const homeDeg = $derived($view.key.col * 30);

  /** Where a chord's star sits: left of its numeral (or name, outside the key), at the numeral's height. */
  function starPoint(c: CircleChord, radius: number): [number, number] {
    const [x, y] = at(c.ref);
    const w = c.inKey ? numWidth(c) : nameWidth(c);
    const s = SIZE[c.ref.ring];
    return [x - w / 2 - 5 - radius, c.inKey ? y + s.numY - s.num * 0.33 : y];
  }

  // The trail, oldest first, each chord once in a row. Its points are the stars (or the ring, now).
  // While a progression is loaded, only the steps of it just played are drawn: the rest of the trail
  // hid the figure to follow.
  const trail = $derived.by(() => {
    const all = $view.trail.filter((r, i, all) => i === 0 || !same(all[i - 1], r)).slice(-8);
    const played = $view.loaded?.played;
    return played === undefined ? all : played === 0 ? [] : all.slice(-played);
  });
  function vertex(r: ChordRef): [number, number] | null {
    const c = chordAt(r);
    if (!c) return null;
    if ($view.sounding && same($view.current, r)) return at(r);
    const p = pOf.get(keyOf(r));
    return starPoint(c, p !== undefined ? starR(p) : TRAIL_STAR);
  }
  const constellation = $derived(trail.map(vertex).filter((p): p is [number, number] => p !== null));
  /**
   * The trail fades as it ages: the newest line in chalk, each older one fainter by
   * the same ratio, so it goes ghostly fast. One width throughout: thinning older lines read as smaller
   * lines, not a fade. Brightness alone carries the order, so it survives desaturation.
   */
  const FADE = 0.6;
  const segments = $derived(
    constellation.slice(1).map((b, i, rest) => {
      const age = rest.length - 1 - i; // 0 newest
      // Under a loaded progression the steps played stay quieter than the lit move to come.
      const under = $view.loaded ? 0.4 : 1;
      return { a: constellation[i], b, age, opacity: Math.max(0.06, under * FADE ** age) };
    }),
  );

  // A progression loaded from the library, drawn as a constellation to come: each step's chord
  // ringed and numbered, joined by straight lines. The next move is lit, with its arrowhead and its
  // chord's ring; the moves after it are ghostly, the reverse of the trail fading behind. Steps already
  // played aren't drawn: they're the trail now.
  const STEP_R = { maj: 21, min: 18, dim: 15 };
  const loaded = $derived($view.loaded);
  const stepAt = (r: ChordRef): [number, number] => {
    const [x, y] = at(r);
    return [x, y + 1.5];
  };
  /** A line from one step's ring to the next's, stopping short of both. */
  function between(a: ChordRef, b: ChordRef, gapA: number, gapB: number) {
    const [ax, ay] = stepAt(a), [bx, by] = stepAt(b);
    const d = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / d, uy = (by - ay) / d;
    return { x1: ax + ux * gapA, y1: ay + uy * gapA, x2: bx - ux * gapB, y2: by - uy * gapB };
  }
  const figure = $derived.by(() => {
    if (!loaded) return null;
    const { steps, played } = loaded;
    const lines = [];
    for (let k = Math.max(1, played); k < steps.length; k++) {
      const lit = k === played;
      // The lit move starts outside the ring the sounding chord wears.
      const from = steps[k - 1].ref, to = steps[k].ref;
      lines.push({ ...between(from, to, STEP_R[from.ring] + (lit ? 7 : 2), STEP_R[to.ring] + 2), lit });
    }
    // A chord the progression comes back to (the Canon's I, V and IV) gets one ring carrying each step's number.
    const rings: { ref: ChordRef; x: number; y: number; r: number; lit: boolean; n: number; ns: number[]; nx: number; ny: number }[] = [];
    steps.forEach((s, i) => {
      if (i < played) return;
      const again = rings.find((r) => same(r.ref, s.ref));
      if (again) {
        again.ns.push(i + 1);
        again.lit ||= i === played;
        return;
      }
      const [x, y] = stepAt(s.ref);
      // The step's number sits just outside its ring, toward the upper left of the cell.
      const [nx, ny] = pol(ANCHOR[s.ref.ring] + (s.ref.ring === "maj" ? 6 : 8), s.ref.col * 30 - (s.ref.ring === "maj" ? 10.5 : 14));
      rings.push({ ref: s.ref, x, y, r: STEP_R[s.ref.ring], lit: i === played, n: i + 1, ns: [i + 1], nx, ny });
    });
    return { lines, rings, next: steps[played] };
  });
  // The corner's numerals with each step's 7th or add9 raised and small, as a jazz chart writes them
  //. A long one (vi7–ii7–V7–Imaj7) is set a little smaller so it stays clear of the rim.
  const cornerSize = $derived(loaded && loaded.numerals.length > 13 ? 16 : 19);

  // The key's wedge outline: three columns of the outer two rings, plus the diminished cell.
  const wedge = $derived.by(() => {
    const d = homeDeg;
    const o = RING.maj.o, i = RING.min.i, m = RING.dim.i;
    return (
      `M${xy(pol(o, d - 45))}A${o} ${o} 0 0 1 ${xy(pol(o, d + 45))}L${xy(pol(i, d + 45))}` +
      `A${i} ${i} 0 0 0 ${xy(pol(i, d + 15))}L${xy(pol(m, d + 15))}A${m} ${m} 0 0 0 ${xy(pol(m, d - 15))}` +
      `L${xy(pol(i, d - 15))}A${i} ${i} 0 0 0 ${xy(pol(i, d - 45))}Z`
    );
  });
  const spokes = [...Array(12).keys()].map((c) => [pol(RING.min.i, c * 30 + 15), pol(RING.maj.o, c * 30 + 15)]);
  const dimSpokes = $derived([-15, 15].map((a) => [pol(RING.dim.i, homeDeg + a), pol(RING.dim.o, homeDeg + a)]));
  const ticks = [...Array(60).keys()].map((t) => ({ a: t * 6, major: t % 5 === 0 }));
  const pointer = $derived([pol(RING.dim.i - 0.5, homeDeg), pol(HUB - 6, homeDeg + 7), pol(HUB - 6, homeDeg - 7)]);
  const isHome = (c: CircleChord) => c.ref.ring === "dim";
</script>

<svelte:window onpointermove={report("move")} onpointerup={report("up")} onpointercancel={report("cancel")} />

<svg bind:this={svg} viewBox="-222 -222 444 444" role="group" aria-label="Circle of fifths" onpointerdown={down}>
  <defs>
    <radialGradient id="atlas-mist" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={RING.maj.o}>
      <stop offset="0.3" style="stop-color: var(--chart-lo)" />
      <stop offset="1" style="stop-color: var(--chart)" />
    </radialGradient>
  </defs>

  <!-- Cells: every chord is a touch target; the key's seven are lit. -->
  {#each $view.chords as c (`${c.ref.ring}-${isHome(c) ? "home" : c.ref.col}`)}
    <path class="cell" class:lit={c.inKey} data-ring={c.ref.ring} data-col={c.ref.col} data-chord={c.plain} d={cellPath(c.ref)} />
  {/each}

  <g class="rules">
    {#each [RING.maj.o, RING.min.o, RING.min.i, RING.dim.i] as r (r)}<circle {r} />{/each}
    {#each spokes as [a, b]}<line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />{/each}
    {#each dimSpokes as [a, b]}<line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />{/each}
  </g>
  <path class="wedge" d={wedge} />

  <!-- The trail as a constellation, beneath everything else, fading with age. -->
  {#if segments.length}
    <g class="constellation">
      {#each segments as s, i (i)}
        <line x1={s.a[0]} y1={s.a[1]} x2={s.b[0]} y2={s.b[1]} data-age={s.age} stroke-opacity={s.opacity.toFixed(2)} />
      {/each}
    </g>
  {/if}

  <!-- Function: a short arc inside each in-key cell's outer edge. -->
  {#each $view.chords.filter((c) => c.inKey && c.fn) as c (`f-${c.ref.ring}-${c.ref.col}`)}
    {@const s = SLIT[c.ref.ring]}
    {@const th = c.ref.col * 30}
    {@const now = $view.sounding && same($view.current, c.ref)}
    {#if c.fn === "both"}
      <path class="slit" class:now d={arc(s.r, th - s.span, th - 0.8)} />
      <path class="slit" class:now d={arc(s.r, th + 0.8, th + s.span)} stroke-dasharray={DASH.dominant} />
    {:else}
      <path class="slit" class:now d={arc(s.r, th - s.span, th + s.span)} stroke-dasharray={DASH[c.fn!]} />
    {/if}
  {/each}

  <!-- Stars: every chord that might come next, brighter and larger for stronger; small dim ones for the trail. -->
  {#each $view.chords as c (`s-${c.ref.ring}-${isHome(c) ? "home" : c.ref.col}`)}
    {@const rank = rankOf.get(keyOf(c.ref))}
    {@const p = pOf.get(keyOf(c.ref))}
    {@const onTrail = trail.some((t) => same(t, c.ref))}
    {#if !($view.sounding && same($view.current, c.ref)) && (p !== undefined || onTrail)}
      {@const radius = p !== undefined ? starR(p) : TRAIL_STAR}
      {@const [x, y] = starPoint(c, radius)}
      <circle class="star" class:next={p !== undefined} data-rank={rank !== undefined && rank < 3 ? rank + 1 : null}
        data-p={p ?? null} cx={x} cy={y} r={radius} style={p !== undefined ? `fill: ${starFill(p)}` : undefined} />
    {/if}
  {/each}

  <!-- A loaded progression's lines run beneath the names, so one crossing a cell doesn't strike out its label. -->
  {#if figure}
    <g class="figure">
      <defs>
        <marker id="figure-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M1,1 L9,5 L1,9" />
        </marker>
      </defs>
      {#each figure.lines as l, i (i)}
        <line class="step-line" class:lit={l.lit} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} marker-end={l.lit ? "url(#figure-head)" : undefined} />
      {/each}
    </g>
  {/if}

  <!-- Names: numeral over name inside the key, the name alone (quieter) outside it. -->
  {#each $view.chords as c (`t-${c.ref.ring}-${isHome(c) ? "home" : c.ref.col}`)}
    {@const [x, y] = at(c.ref)}
    {@const s = SIZE[c.ref.ring]}
    {@const now = $view.sounding && same($view.current, c.ref)}
    <!-- A loaded shape's next chord is named as its step plays it (Cmaj7), unless a pad held renames every cell. -->
    {@const name = $view.leads && same($view.leads.ref, c.ref)
      ? $view.leads.name
      : figure?.next.top && !$view.relabeled && same(figure.next.ref, c.ref) ? figure.next.name : c.name}
    {#if c.inKey}
      <text class="num" class:now x={x} y={y + s.numY} font-size={s.num}>{c.numeral}</text>
      <text class="name" class:now x={x} y={y + s.nameY} font-size={s.name}>{name}</text>
    {:else}
      <text class="out" class:now x={x} y={y + 4} font-size={s.out}>{name}</text>
    {/if}
  {/each}

  <!-- A progression from the library, as a constellation still to trace. -->
  {#if figure}
    <g class="figure">
      {#each figure.rings as r (r.n)}
        <circle class="step-ring" class:lit={r.lit} data-step={r.n} cx={r.x} cy={r.y} r={r.r} />
        <text class="step-n" class:lit={r.lit} x={r.nx - (r.ns.length > 1 ? 8 : 0)} y={r.ny + 3}>{r.ns.join("·")}</text>
      {/each}
    </g>
  {/if}

  <!-- After a long press: the chord that leads here. -->
  {#if $view.leads}
    {@const c = chordAt($view.leads.ref)}
    {@const [x, y] = at($view.leads.ref)}
    <circle class="leads" data-leads={$view.leads.name} cx={x} cy={y + 1.5} r={23.5} stroke-dasharray={DASH.dominant} />
    <text class="leads-word" x={x} y={y - (c?.inKey ? 21 : 11)}>LEADS HERE</text>
  {/if}

  <!-- The sounding chord wears a ring: engaged. -->
  {#if $view.current && $view.sounding}
    {@const [x, y] = at($view.current)}
    {@const big = $view.current.ring === "dim" ? 16 : $view.current.ring === "min" ? 21 : 23.5}
    <circle class="ring-outer" cx={x} cy={y + 1.5} r={big + 4} />
    <circle class="ring" cx={x} cy={y + 1.5} r={big} />
  {/if}

  <!-- While the key is dragged: the line between major (outside) and minor (inside). -->
  {#if $view.moving}
    <circle class="mode-line" r={RING.maj.i} />
    <text class="mode-word" x="0" y={-RING.maj.i - 5}>major</text>
    <text class="mode-word" x="0" y={-RING.maj.i + 13}>minor</text>
  {/if}

  <!-- The hub is the key dial: drag from it onto a chord. -->
  <g class="dial">
    <circle class="hub" data-head r={HUB} />
    {#each ticks as t (t.a)}
      {@const [x1, y1] = pol(HUB - (t.major ? 6 : 3), t.a)}
      {@const [x2, y2] = pol(HUB - 0.5, t.a)}
      <line class="tick" class:major={t.major} {x1} {y1} {x2} {y2} />
    {/each}
    <path class="pointer" d={`M${xy(pointer[0])}L${xy(pointer[1])}L${xy(pointer[2])}Z`} />
    <text class="dial-cap" x="0" y="-18">KEY</text>
    <text class="dial-key" x="0" y="12">{$view.key.name}</text>
    <text class="dial-mode" x="0" y="26">{$view.key.mode}</text>
    <text class="dial-hint" x="0" y="38">drag</text>
  </g>

  <!-- What's loaded, in the open corner, and how to put it away. -->
  {#if loaded && figure}
    <g class="legend loaded" data-loaded={loaded.numerals}>
      <text class="loaded-numerals" x="-216" y="-203" style:font-size="{cornerSize}px"
        >{#each loaded.steps as st, i (i)}<tspan dy={i && loaded.steps[i - 1].top ? cornerSize * 0.38 : 0}>{i ? "–" : ""}{st.numeral}</tspan
          >{#if st.top}<tspan class="sup" dy={-cornerSize * 0.38} font-size={cornerSize * 0.62}>{st.top}</tspan>{/if}{/each}</text>
      <text class="loaded-name" x="-216" y="-189">{loaded.name}</text>
      <text class="loaded-name" x="-216" y="-176">in {loaded.where}</text>
      <g class="put-away" role="button" tabindex="0" aria-label="Put the shape away"
        onclick={() => send({ type: "shapeChosen", shape: null })}
        onkeydown={(e) => (e.key === "Enter" || e.key === " ") && send({ type: "shapeChosen", shape: null })}>
        <rect x="-220" y="-173" width="74" height="22" />
        <text class="small left" x="-216" y="-158">× put away</text>
      </g>
    </g>
  {/if}

  <!-- The legends sit in the corners, beside what they explain. -->
  {#if $view.next.length}
    <g class="legend">
      <text class="cap end" x="214" y="-200">LIKELY NEXT</text>
      {#each SCALE as p, i (p)}
        {@const x = 128 + [0, 21, 39, 54][i]}
        <circle class="star next" cx={x} cy="-184" r={starR(p)} style={`fill: ${starFill(p)}`} />
        <text class="small" x={x} y="-164">{Math.round(p * 100)}</text>
      {/each}
      <text class="small" x="196" y="-164">%</text>
      <circle class="ring" cx="205" cy="-184" r="7" />
      <text class="small" x="205" y="-151">now</text>
    </g>
  {/if}
  <g class="legend">
    <line class="slit" x1="-216" y1="168" x2="-198" y2="168" />
    <text class="small left" x="-192" y="171">home</text>
    <line class="slit" x1="-216" y1="183" x2="-198" y2="183" stroke-dasharray={DASH.subdominant} />
    <text class="small left" x="-192" y="186">away</text>
    <line class="slit" x1="-216" y1="198" x2="-198" y2="198" stroke-dasharray={DASH.dominant} />
    <text class="small left" x="-192" y="201">tension</text>
  </g>

  <!-- Sustain, in the corner under the right thumb. It acts on touch, like the pads. -->
  <g class="sustain" role="button" tabindex="0" aria-label="Sustain" aria-pressed={$view.sustain}
    onpointerdown={() => send({ type: "sustainToggled" })}
    onmousedown={(e) => e.preventDefault()}
    onkeydown={(e) => (e.key === "Enter" || e.key === " ") && send({ type: "sustainToggled" })}>
    <circle class="sustain-disc" class:on={$view.sustain} cx="201" cy="188" r="30" />
    {#if $view.sustain}<circle class="sustain-ring" cx="201" cy="188" r="25.5" />{/if}
    <text class="sustain-word" x="201" y="189">Sustain</text>
    <text class="sustain-state" x="201" y="203">{$view.sustain ? "on" : "off"}</text>
  </g>
</svg>

<style>
  svg { display: block; width: 100%; height: 100%; overflow: visible; touch-action: none; }
  .cell { fill: transparent; stroke: none; pointer-events: all; }
  .cell.lit { fill: url(#atlas-mist); }
  .rules { fill: none; stroke: var(--rule); stroke-width: 1; pointer-events: none; }
  .wedge { fill: none; stroke: var(--rule-2); stroke-width: 1; pointer-events: none; }
  .constellation { fill: none; stroke: var(--ink); stroke-width: 1.2; stroke-linecap: round; pointer-events: none; }
  .slit { fill: none; stroke: var(--ink-2); stroke-width: 1.6; stroke-linecap: round; pointer-events: none; }
  .slit.now { stroke: var(--ink); }
  .star { fill: var(--ink-2); stroke: var(--chart); stroke-width: 2.5; paint-order: stroke; pointer-events: none; }
  .star.next { fill: var(--ink); }
  text { text-anchor: middle; pointer-events: none; paint-order: stroke; stroke: var(--chart); stroke-width: 3.5px; stroke-linejoin: round; }
  .num { font-family: var(--font-serif); font-weight: 400; fill: var(--ink); }
  .num.now { font-weight: 500; }
  .name { font-family: var(--font-serif); font-style: italic; fill: var(--ink-2); }
  .name.now { fill: var(--ink); font-weight: 500; }
  .out { font-family: var(--font-serif); font-style: italic; fill: var(--ink-3); stroke: var(--ground); }
  .out.now { fill: var(--ink); font-weight: 500; }
  .ring { fill: none; stroke: var(--ink); stroke-width: 2; pointer-events: none; }
  .leads { fill: none; stroke: var(--ink); stroke-width: 2.2; stroke-linecap: round; pointer-events: none; }
  .leads-word { font: 500 8px var(--font-caps); letter-spacing: 0.12em; fill: var(--lamp); }
  .ring-outer { fill: none; stroke: var(--faint); stroke-width: 1; pointer-events: none; }
  .mode-line { fill: none; stroke: var(--ink); stroke-width: 1; pointer-events: none; }
  .mode-word { font: 400 11px var(--font-text); fill: var(--ink-3); stroke: var(--ground); }
  .hub { fill: var(--hub); stroke: var(--rule-2); stroke-width: 1; pointer-events: all; }
  .tick { stroke: var(--rule-2); stroke-width: 1; pointer-events: none; }
  .tick.major { stroke: var(--faint); }
  .pointer { fill: var(--ink); pointer-events: none; }
  .dial text { stroke: var(--hub); }
  .dial-cap { font: 500 9px var(--font-caps); letter-spacing: 0.14em; fill: var(--lamp); }
  .dial-key { font: italic 300 34px var(--font-serif); fill: var(--ink); }
  .dial-mode { font: italic 400 12px var(--font-serif); fill: var(--ink-2); }
  .dial-hint { font: 400 11px var(--font-text); letter-spacing: 0.04em; fill: var(--ink-3); }
  .legend text { stroke: var(--ground); }
  .cap { font: 500 9px var(--font-caps); letter-spacing: 0.14em; fill: var(--lamp); }
  .small { font: 400 11px var(--font-text); fill: var(--ink-3); }
  .small.left { text-anchor: start; }
  .end { text-anchor: end; }
  .left { text-anchor: start; }
  .step-line { stroke: var(--constellation); stroke-width: 0.8; pointer-events: none; }
  .step-line.lit { stroke: var(--ink); stroke-width: 1.4; }
  .figure marker path { fill: none; stroke: var(--ink); stroke-width: 1.4; stroke-linejoin: round; }
  .step-ring { fill: none; stroke: var(--constellation); stroke-width: 0.8; pointer-events: none; }
  .step-ring.lit { stroke: var(--ink); stroke-width: 1.3; }
  .step-n { font: 500 12.5px var(--font-text); fill: var(--ink-3); stroke-width: 3px; }
  .step-n.lit { fill: var(--ink); }
  .loaded-numerals { font: 400 19px var(--font-serif); fill: var(--ink); text-anchor: start; }
  .loaded-name { font: italic 400 10.5px var(--font-serif); fill: var(--ink-2); text-anchor: start; }
  .sustain { cursor: pointer; }
  /* A tap mustn't leave the browser's focus box on it. A keyboard still gets one. */
  .sustain:focus:not(:focus-visible) { outline: none; }
  .sustain-disc { fill: var(--chart-lo); stroke: var(--rule-2); stroke-width: 1; pointer-events: all; }
  .sustain-disc.on { stroke: var(--faint); }
  .sustain-ring { fill: none; stroke: var(--ink); stroke-width: 2; pointer-events: none; }
  .sustain-word { font: 400 14px var(--font-serif); fill: var(--ink); stroke: none; }
  .sustain-state { font: italic 400 12px var(--font-serif); fill: var(--ink-2); stroke: none; }
  .put-away { cursor: pointer; }
  .put-away rect { fill: transparent; pointer-events: all; }
</style>
