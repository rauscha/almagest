<script lang="ts">
  // Stands in for any slot, for a module that's not built or is being rebuilt.
  import type { ReadableAtom } from "nanostores";
  import type { Send } from "../../core/contract";

  let { view, send: _send }: { view: ReadableAtom<unknown>; send: Send } = $props();
  const seen = $derived($view !== undefined);
</script>

<div class="stub" data-stub data-live={seen}></div>

<style>
  .stub {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: 1px dashed var(--line);
  }
</style>
