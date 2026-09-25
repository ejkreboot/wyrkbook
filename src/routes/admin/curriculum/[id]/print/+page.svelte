<script lang="ts">
	import { onMount } from 'svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import { weekLabel } from '$lib/week';

	let { data } = $props();

	const r = $derived(data.resource);

	// Open the print dialog on arrival — once fonts (KaTeX's included) have
	// loaded, so math isn't printed in a fallback face. Switching handout /
	// teacher copy keeps this component mounted, so it doesn't fire again.
	onMount(() => {
		let left = false;
		document.fonts.ready.then(() => {
			if (!left) window.print();
		});
		return () => (left = true);
	});
</script>

<svelte:head>
	<title>{r.title}{data.notes ? ' (teacher copy)' : ''}</title>
</svelte:head>

<div class="wrap wrap-narrow">
	<!-- Screen-only toolbar; hidden by the print stylesheet. -->
	<div class="no-print row-between" style="margin-bottom:1.5rem">
		<a class="btn btn-ghost btn-sm" href="/admin/curriculum/{r.id}">← Back to editor</a>
		<div class="row">
			{#if data.notes}
				<a class="btn btn-sm" href="?notes=0">Show as handout</a>
			{:else}
				<a class="btn btn-sm" href="?notes=1">Show teacher notes</a>
			{/if}
			<button class="btn btn-primary" onclick={() => window.print()}>Print</button>
		</div>
	</div>

	<div class="sheet-head">
		<div>
			<h1>{r.title}</h1>
			<div class="sheet-meta">
				{data.className}
				{#if r.week_start}· week of {weekLabel(r.week_start)}{/if}
				{#if data.notes}· <strong>teacher copy</strong>{/if}
			</div>
		</div>
	</div>

	<Markdown source={r.body} notes={data.notes} />
</div>
