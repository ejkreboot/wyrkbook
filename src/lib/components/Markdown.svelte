<script lang="ts">
	import 'katex/dist/katex.min.css';
	import { renderMarkdown } from '$lib/markdown';

	let {
		source,
		notes = true
	}: {
		source: string;
		/** False removes teacher notes from the output, not just from view. */
		notes?: boolean;
	} = $props();

	const html = $derived(renderMarkdown(source, { notes }));
</script>

<!-- Safe to inject: raw HTML is disabled in the renderer and KaTeX runs untrusted. -->
<div class="md">{@html html}</div>
