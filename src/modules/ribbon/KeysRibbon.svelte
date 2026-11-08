<script lang="ts">
  // The voices beside a keyboard, in the star atlas.
  // One row per semitone, accidental rows shaded across the roll, the keys of the sounding notes lit. A
  // line that carries on with no new point is a held tone; a short slant is a slide. Every point is the
  // same size, because size on this chart means only how likely a chord is next. The trail of chord names
  // and numerals sits beneath.
  import type { ModuleProps } from "../../core/contract";

  let { view }: ModuleProps<"ribbon"> = $props();

  const W = 258;
  const TOP = 26; // below the section rule
  const BOTTOM = 238; // the keyboard's lowest edge
  const KEY_X = 20, KEY_W = 22, ROLL_X = KEY_X + KEY_W + 4, ROLL_END = 222;
  const MIN_ROWS = 28;
  const ACCIDENTAL = new Set([1, 3, 6, 8, 10]);

  const columns = $derived($view.columns);
  const notesOf = (c: { upper: number[]; bass: number }) => [...c.upper, c.bass];

  // The window of pitches drawn: wide enough for every note in the trail, never under 28 semitones. It
  // widens at once and narrows only when the notes clearly fit a smaller one, so it doesn't jitter.
  let window = $state<[number, number]>([40, 67]);
  $effect(() => {
    const all = columns.flatMap(notesOf);
    if (!all.length) return;
    const lo = Math.min(...all) - 2, hi = Math.max(...all) + 2;
    const [wlo, whi] = window;
    const fits = lo >= wlo && hi <= whi;
    const span = Math.max(MIN_ROWS, hi - lo + 1);
    const tooBig = whi - wlo + 1 > span * 1.5;
    if (fits && !tooBig) return;
    const pad = span - (hi - lo + 1);
    const nlo = lo - Math.floor(pad / 2);
    window = [nlo, nlo + span - 1];
  });
  const rows = $derived(window[1] - window[0] + 1);
  const rowH = $derived((BOTTOM - TOP) / rows);
  const yOf = (m: number) => TOP + (window[1] - m) * rowH + rowH / 2;

  // Columns: the chord now is wide, the ones before it narrow, all inside the roll.
  const NOW_W = 52;
  const pastW = $derived(columns.length > 1 ? Math.min(30, (ROLL_END - ROLL_X - NOW_W) / (columns.length - 1)) : 0);
  const colX = (j: number) => ROLL_X + 8 + j * pastW;
  const colEnd = (j: number) => (j === columns.length - 1 ? ROLL_END : colX(j + 1));
  const last = $derived(columns.length - 1);

  const lit = $derived(new Set($view.sounding.map((n) => n.midi)));
  const ringing = $derived($view.sounding.length > 0);

  const SLANT_BEFORE = 4; // how far before its chord's column a slant starts
  /** A chord's numeral without what a pad added, for the older chords' narrow columns: vi for vi7. */
  const bareNumeral = (n: string) => n.match(/^[♭♯]*[IVXivx]+°?/)?.[0] ?? n;
  /** How far right a long numeral under the chord now sits, so it clears the older numeral beside it. */
  const clearOfOlder = (n: string) => (last > 0 ? Math.max(0, (n.length * 5.5) / 2 + 9 - pastW) : 0);

  /** Each voice's path through the trail: held tones continue, changes slant in from the note before. */
  type Seg = { kind: "line" | "slant"; x1: number; y1: number; x2: number; y2: number; now: boolean };
  type Head = { x: number; y: number; now: boolean };
  const drawn = $derived.by(() => {
    const segs: Seg[] = [], heads: Head[] = [];
    if (!columns.length) return { segs, heads };
    const voices = notesOf(columns[last]).length;
    for (let v = 0; v < voices; v++) {
      for (let j = 0; j <= last; j++) {
        const note = notesOf(columns[j])[v];
        if (note === undefined) continue;
        const prev = j > 0 ? notesOf(columns[j - 1])[v] : undefined;
        const now = j === last && ringing;
        // A note that's about to change stops where its slant begins, so nothing overhangs the slant.
        const after = j < last ? notesOf(columns[j + 1])[v] : undefined;
        const x = colX(j), y = yOf(note), end = colEnd(j) - (after !== undefined && after !== note ? SLANT_BEFORE : 0);
        if (prev === note) {
          segs.push({ kind: "line", x1: x, y1: y, x2: end, y2: y, now });
        } else {
          if (prev !== undefined) segs.push({ kind: "slant", x1: x - SLANT_BEFORE, y1: yOf(prev), x2: x + 6, y2: y, now });
          segs.push({ kind: "line", x1: x + 6, y1: y, x2: end, y2: y, now });
          heads.push({ x: x + 6, y, now });
        }
      }
    }
    return { segs, heads };
  });

  const keyRows = $derived([...Array(rows).keys()].map((i) => window[1] - i));
  const octaveName = (m: number) => `C${Math.floor(m / 12) - 1}`;
  const moved = $derived(new Set($view.moves.map((mv) => mv.to)));

  // The names at the right sit beside their rows, but two voices a semitone apart are closer than a line
  // of type, so a crowded group spreads evenly around where its notes are.
  const NAME_GAP = 9;
  const names = $derived.by(() => {
    const sorted = [...$view.sounding].sort((a, b) => b.midi - a.midi);
    const groups: { notes: typeof sorted; top: number }[] = [];
    for (const n of sorted) {
      groups.push({ notes: [n], top: yOf(n.midi) });
      while (groups.length > 1) {
        const [a, b] = groups.slice(-2);
        if (a.top + a.notes.length * NAME_GAP <= b.top) break;
        const notes = [...a.notes, ...b.notes];
        const top = notes.reduce((t, m, i) => t + yOf(m.midi) - i * NAME_GAP, 0) / notes.length;
        groups.splice(-2, 2, { notes, top });
      }
    }
    const at = new Map(groups.flatMap((g) => g.notes.map((n, i) => [n.midi, g.top + i * NAME_GAP] as const)));
    return $view.sounding.map((n) => ({ n, y: at.get(n.midi)! }));
  });
</script>

<svg class="ribbon" viewBox="0 0 {W} 300" role="img" aria-label="The voices, beside a keyboard">
  <defs>
    <linearGradient id="keys-decay" gradientUnits="userSpaceOnUse" x1={colX(last)} x2={ROLL_END} y1="0" y2="0">
      <stop offset="0" style="stop-color: var(--ink)" />
      <stop offset="1" style="stop-color: var(--faint)" />
    </linearGradient>
  </defs>

  <!-- Section rule, in the atlas manner. -->
  <text class="cap" x="0" y="11">VOICES</text>
  <line class="rule" x1="58" y1="8" x2={W - 3} y2="8" />
  <circle class="node" cx="58" cy="8" r="1.4" /><circle class="node" cx={W - 2} cy="8" r="1.4" />

  <!-- Rows: accidental rows shaded across the roll; C rows ruled and labeled. -->
  {#each keyRows as m (m)}
    {@const y = TOP + (window[1] - m) * rowH}
    {@const acc = ACCIDENTAL.has(((m % 12) + 12) % 12)}
    {#if acc}<rect class="row-acc" x={ROLL_X} {y} width={ROLL_END - ROLL_X + 4} height={rowH} />{/if}
    <rect class="key" class:acc class:lit={lit.has(m)} x={KEY_X} {y} width={acc ? KEY_W * 0.62 : KEY_W} height={rowH} />
    {#if m % 12 === 0}
      <line class="c-rule" x1={ROLL_X} y1={y + rowH} x2={ROLL_END + 4} y2={y + rowH} />
      <text class="small end" x={KEY_X - 4} y={y + rowH - 0.5}>{octaveName(m)}</text>
    {/if}
  {/each}
  <line class="rule" x1={ROLL_X} y1={TOP} x2={ROLL_X} y2={BOTTOM} />

  <!-- Bar-line hairlines between the chords. -->
  {#each columns.slice(1) as _, j (j)}
    <line class="bar" x1={colX(j + 1)} y1={TOP} x2={colX(j + 1)} y2={BOTTOM} />
  {/each}

  <!-- The voices. -->
  {#each drawn.segs as s, i (i)}
    <line class="voice" class:slant={s.kind === "slant"} class:now={s.now} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
      stroke={s.now && s.kind === "line" ? "url(#keys-decay)" : undefined} />
  {/each}
  {#each drawn.heads as h, i (i)}
    <circle class="head" class:now={h.now} cx={h.x} cy={h.y} r="2.6" />
    {#if h.now}<circle class="head-ring" cx={h.x} cy={h.y} r="5.2" />{/if}
  {/each}

  <!-- What's sounding, named, at the right; a held tone quieter than one that moved. A note a pad added
       says which it is, 7 or 9, as the leading tone says LT. -->
  {#each names as { n, y } (n.midi)}
    <text class="note" class:held={!moved.has(n.midi)} x={W} y={y + 3} data-role={n.role}
      >{n.name}{$view.leadingTone?.midi === n.midi ? " LT" : ""}{#if n.role}<tspan class="role">{` ${n.role}`}</tspan>{/if}</text>
  {/each}

  <!-- The trail: each chord's name and numeral under its column. -->
  {#each columns as c, j (j)}
    {@const x = colX(j) + 6}
    {@const now = j === last}
    <!-- Crowded, the older chords give up their names and keep their numerals. -->
    {#if now || pastW >= 26}<text class="trail-name" class:now x={now && pastW >= 26 ? x + Math.max(0, c.name.length * 5 + 19 - pastW) : x} y="262" font-size={now ? 15 : 12}>{c.name}</text>{/if}
    <text class="trail-num" class:now x={now ? x + clearOfOlder(c.numeral) : x} y="277" font-size={now ? 12 : pastW >= 26 ? 11 : 10}>{now ? c.numeral : bareNumeral(c.numeral)}</text>
  {/each}
  {#if columns.length}
    {#if $view.shapes.length}
      <!-- Named progressions bracket their numerals, as analysis marks do on a jazz chart; the one
           the chord now completes is bright, older ones dim. Two sharing a chord meet under it. -->
      {#each $view.shapes as s, i (i)}
        {@const x1 = colX(s.from) + 6 - ($view.shapes[i - 1]?.to === s.from ? -2 : 5)}
        {@const x2 = colX(s.to) + 6 + ($view.shapes[i + 1]?.from === s.to ? -2 : 5)}
        <path class="bracket" class:now={s.now} d="M{x1},289 V292 H{x2} V289" />
        <text class="bracket-name" class:now={s.now} x={(x1 + x2) / 2} y="301">{s.short}</text>
      {/each}
    {:else}
      <line class="rule" x1={colX(0) + 6} y1="288" x2={W - 2} y2="288" />
      {#each columns as _, j (j)}<line class="tick" x1={colX(j) + 6} y1="285.5" x2={colX(j) + 6} y2="290.5" />{/each}
    {/if}
    <text class="small" x="0" y="291">trail</text>
  {/if}
</svg>

<style>
  .ribbon { display: block; width: 100%; height: 100%; overflow: visible; }
  .cap { font: 500 9px var(--font-caps); letter-spacing: 0.14em; fill: var(--lamp); }
  .rule { stroke: var(--rule-2); stroke-width: 1; }
  .node { fill: var(--faint); }
  .row-acc { fill: var(--chart-lo); }
  .key { fill: var(--hub); stroke: var(--ground); stroke-width: 0.6; }
  .key.acc { fill: var(--rule-2); }
  .key.lit { fill: var(--ink); }
  .c-rule { stroke: var(--rule-2); stroke-width: 1; }
  .bar { stroke: var(--rule); stroke-width: 1; stroke-dasharray: 1 3; }
  .voice { stroke: var(--ink-3); stroke-width: 1.1; }
  .voice.slant { stroke-width: 1; }
  .voice.now { stroke: var(--ink); stroke-width: 1.6; }
  .voice.now.slant { stroke-width: 1; }
  .head { fill: var(--ink-3); }
  .head.now { fill: var(--ink); }
  .head-ring { fill: none; stroke: var(--ink); stroke-width: 1; }
  .small { font: 400 11px var(--font-text); fill: var(--ink-3); }
  .small.end, .note { text-anchor: end; }
  .note { font: 400 11.5px var(--font-text); fill: var(--ink-2); }
  .note.held { fill: var(--ink-3); }
  .role { fill: var(--ink); font-weight: 500; }
  .trail-name { font-family: var(--font-serif); font-style: italic; fill: var(--ink-2); text-anchor: middle; }
  .trail-name.now { fill: var(--ink); font-weight: 500; }
  .trail-num { font-family: var(--font-serif); fill: var(--ink-3); text-anchor: middle; }
  .trail-num.now { fill: var(--ink); }
  .tick { stroke: var(--faint); stroke-width: 1; }
  .bracket { fill: none; stroke: var(--ink-3); stroke-width: 0.8; }
  .bracket.now { stroke: var(--ink); stroke-width: 1.1; }
  .bracket-name { font: 500 7px var(--font-caps); letter-spacing: 0.12em; fill: var(--ink-3); text-anchor: middle; }
  .bracket-name.now { fill: var(--lamp); }
</style>
