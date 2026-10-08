<script lang="ts">
	import 'katex/dist/katex.min.css';
	import { renderProblem } from '$lib/markdown';

	let { body, class: cls = '' }: { body: string; class?: string } = $props();

	const html = $derived(renderProblem(body));
</script>

<!-- Safe to inject: the problem renderer has raw HTML off and knows only math and line breaks. -->
<div class="ptext {cls}">{@html html}</div>
