<script lang="ts">
  // What's sounding, in the star atlas: the chord large, its numeral, and its function as the same
  // mark the circle draws, beside the word, so the mark is learned by being next to its meaning.
  import { tick } from "svelte";
  import type { Fn, ModuleProps } from "../../core/contract";

  let { view }: ModuleProps<"readout"> = $props();

  /** Plain word first, the textbook word after it. */
  const WORD: Record<Fn, [string, string]> = {
    tonic: ["Home", "tonic"],
    subdominant: ["Away", "subdominant"],
    dominant: ["Tension", "dominant"],
    both: ["Home or tension", "mediant"],
  };
  const DASH: Record<Fn, string> = { tonic: "none", subdominant: "5 3.2", dominant: "0.1 3.4", both: "none" };

  /** A chord's letter and accidentals, then whatever follows, set smaller. */
  /** Letter, accidentals, and the rest. Accidentals come from the music font and are set small and raised, as engraved. */
  const split = (name: string) => {
    const m = name.match(/^([A-G])([♭♯𝄪]*)(.*)$/);
    return m ? [m[1], m[2], m[3]] : [name, "", ""];
  };
  const splitNumeral = (n: string) => {
    const m = n.match(/^([♭♯]*)((?:VII|VI|V|IV|III|II|I|vii|vi|v|iv|iii|ii|i)°?)(.*)$/);
    return m ? [m[1], m[2], m[3]] : ["", n, ""];
  };
  const raised = $derived($view.relation.endsWith(", raised"));

  // The progression's name takes the room it has: beside the chord in full, then its numerals alone,
  // then its numerals at the end of the function's row, and if none fit, only the trail's bracket names it.
  const FITS = ["full", "numerals", "below", "none"] as const;
  let fit = $state(0);
  let line = $state<HTMLDivElement>();
  let fnRow = $state<HTMLDivElement>();
  const over = (el?: HTMLElement) => !!el && el.scrollWidth > el.clientWidth + 0.5;
  $effect(() => {
    void $view.shape;
    void $view.name;
    void $view.numeral;
    void $view.relation;
    fit = 0;
    let stop = false;
    const step = () => {
      if (stop || fit >= FITS.length - 1 || !(over(line) || over(fnRow))) return;
      fit++;
      tick().then(step);
    };
    tick().then(step);
    return () => (stop = true);
  });
  const shown = $derived(FITS[fit]);
</script>

<div class="readout" class:last={!$view.sounding}>
  {#if $view.name}
    {@const [letter, acc, quality] = split($view.name)}
    {@const [numAcc, num, numTop] = splitNumeral($view.numeral)}
    <div class="line" bind:this={line}>
      <span class="chord">{letter}{#if acc}<span class="acc">{acc}</span>{/if}<span class="quality">{quality}</span></span>
      <span class="numeral">{#if numAcc}<span class="acc">{numAcc}</span>{/if}{num}<span class="top">{numTop}</span></span>
      <!-- The progression this chord just completed, beside it. -->
      {#if $view.shape && (shown === "full" || shown === "numerals")}
        <span class="shape" data-shape={$view.shape.numerals}>
          <span class="shape-numerals">{$view.shape.numerals}</span>
          {#if shown === "full"}
            <span class="shape-name">{$view.shape.name}</span>
            {#if $view.shape.where}<span class="shape-where">in {$view.shape.where}</span>{/if}
          {/if}
        </span>
      {/if}
    </div>
    <div class="fn" bind:this={fnRow}>
      {#if $view.fn}
        <svg class="mark" viewBox="0 0 24 6" aria-hidden="true">
          {#if $view.fn === "both"}
            <line x1="1" y1="3" x2="11" y2="3" />
            <line x1="13" y1="3" x2="23" y2="3" stroke-dasharray={DASH.dominant} />
          {:else}
            <line x1="1" y1="3" x2="23" y2="3" stroke-dasharray={DASH[$view.fn]} />
          {/if}
        </svg>
        <span class="word">{WORD[$view.fn][0]}</span>
        <span class="term">({WORD[$view.fn][1]}{raised ? ", raised" : ""})</span>
      {:else}
        <span class="word">Outside the key</span>
      {/if}
      {#if $view.shape && shown === "below"}<span class="shape-below" data-shape={$view.shape.numerals}>{$view.shape.numerals}</span>{/if}
    </div>
    {#if $view.moved !== null}<div class="moved">Moved {$view.moved} semitone{$view.moved === 1 ? "" : "s"}</div>{/if}
  {:else}
    <div class="line">
      <span class="chord">{$view.key.name}</span>
      <span class="numeral mode">{$view.key.mode}</span>
    </div>
    <div class="fn"><span class="word quiet">Seven chords in the key, nothing sounding.</span></div>
  {/if}
  {#if !$view.audioOk}
    <div class="audio" role="status">sound stopped · touch a chord to wake it</div>
  {/if}
</div>

<style>
  .readout { position: relative; height: 100%; color: var(--ink); font-family: var(--font-serif); }
  /* The last chord played, kept to read after its sound has gone: a step quieter, never gone. */
  .readout.last .line, .readout.last .fn { color: var(--ink-2); }
  .readout.last .mark line { stroke: var(--ink-2); }
  .line { display: flex; align-items: baseline; gap: 14px; white-space: nowrap; }
  .chord { font-style: italic; font-weight: 300; font-size: 64px; line-height: 0.95; letter-spacing: -0.01em; }
  .quality { font-size: 40px; }
  .acc { font-family: "Noto Music", serif; font-style: normal; font-weight: 400; font-size: 0.5em; vertical-align: 0.62em; margin: 0 0.04em; }
  .numeral .acc { font-size: 0.6em; vertical-align: 0.4em; }
  .numeral { font-weight: 400; font-size: 30px; line-height: 1; }
  .numeral .top { font-size: 20px; }
  .numeral.mode { font-style: italic; font-weight: 300; color: var(--ink-2); }
  .shape { display: inline-flex; flex-direction: column; align-self: center; margin-left: 16px; }
  .shape-numerals { font-size: 24px; line-height: 1.1; }
  .shape-name { font: 500 9px var(--font-caps); letter-spacing: 0.14em; text-transform: uppercase; color: var(--lamp); margin-top: 4px; }
  .shape-below { margin-left: auto; padding-left: 12px; font-size: 17px; }
  .shape-where { font: 400 12.5px var(--font-text); color: var(--ink-3); margin-top: 3px; }
  .fn { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; white-space: nowrap; }
  .mark { width: 24px; height: 6px; flex: none; align-self: center; }
  .mark line { stroke: var(--ink); stroke-width: 1.8; stroke-linecap: round; }
  .word { font-style: italic; font-size: 17px; }
  .word.quiet { font-size: 13.5px; color: var(--ink-2); }
  .term { font: 400 12.5px var(--font-text); color: var(--ink-3); }
  .moved { font: 400 12.5px var(--font-text); color: var(--ink-3); margin-top: 8px; white-space: nowrap; }
  .audio {
    position: absolute; right: 0; top: 0; font: 400 10px var(--font-text); color: var(--ink); white-space: nowrap;
    padding: 3px 7px; border: 1px solid var(--ink-2); border-radius: 999px;
  }
</style>
