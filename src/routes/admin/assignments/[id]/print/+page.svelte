<script lang="ts">
	import { weekLabel } from '$lib/week';

	let { data } = $props();

	const a = $derived(data.assignment);
	const pages = $derived(Array.from({ length: a.work_pages ?? 0 }, (_, i) => i + 1));
</script>

<svelte:head>
	<title>{a.title}</title>
</svelte:head>

<div class="wrap">
	<!-- Screen-only toolbar; hidden by the print stylesheet. -->
	<div class="no-print row-between" style="margin-bottom:1.5rem">
		<a class="btn btn-ghost btn-sm" href="/admin/assignments/{a.id}">← Back to editor</a>
		<div class="row">
			<span class="muted small">
				{data.problems.length} problems + {a.work_pages} ruled page{a.work_pages === 1 ? '' : 's'}
			</span>
			<button class="btn btn-primary" onclick={() => window.print()}>Print</button>
		</div>
	</div>

	{#if !data.problems.length}
		<div class="empty no-print">
			<h3>Nothing to print</h3>
			<p>Every problem in this assignment is unchecked.</p>
		</div>
	{/if}

	<!-- ---------------------------------------------------- problem sheet -->
	<div class="sheet-head">
		<div>
			<h1>{a.title}</h1>
			<div class="sheet-meta">
				{data.className}
				{#if a.week_start}· week of {weekLabel(a.week_start)}{/if}
			</div>
			<div class="sheet-meta" style="margin-top:6mm">
				Name _______________________________ Date ______________
			</div>
		</div>
		<div class="sheet-qr">
			{@html data.qr}
			<div style="font-size:7pt;text-align:center;color:#666;margin-top:1mm">scan to start</div>
		</div>
	</div>

	{#if a.instructions}
		<div class="sheet-instructions">{a.instructions}</div>
	{/if}

	<ol class="print-problems">
		{#each data.problems as p (p.id)}
			<li>
				<span class="plabel">{p.label}.</span>
				<span class="pbody">{p.body}</span>
			</li>
		{/each}
	</ol>

	<!-- ---------------------------------------------------- ruled work pages -->
	{#each pages as n (n)}
		<div class="work-page">
			<div class="work-head">
				<span>{a.title}</span>
				<span>Name _____________________ · page {n} of {pages.length}</span>
			</div>
			<div class="work-body">
				<div class="work-margin">
					<div class="work-margin-label">problem #</div>
				</div>
				<div class="work-rules"></div>
			</div>
		</div>
	{/each}
</div>
