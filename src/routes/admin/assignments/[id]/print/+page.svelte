<script lang="ts">
	import { weekLabel } from '$lib/week';
	import ProblemText from '$lib/components/ProblemText.svelte';
	import { DEFAULT_WORK_LINES, WORK_LINE_MM } from '$lib/workSpace';

	let { data } = $props();

	const a = $derived(data.assignment);
	const pages = $derived(Array.from({ length: a.work_pages ?? 0 }, (_, i) => i + 1));

	/** Room below a problem to work it: its own lines, or the default if it was never sized. */
	const space = (lines: number | null) => `${(lines ?? DEFAULT_WORK_LINES) * WORK_LINE_MM}mm`;
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
				{data.problems.length} problems, each with room to work it{#if a.work_pages}{' '}+ {a.work_pages}
					extra ruled page{a.work_pages === 1 ? '' : 's'}{/if}
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
		<ProblemText body={a.instructions} class="sheet-instructions" />
	{/if}

	<!--
		Each problem is followed by its own room to work it, so the work sits under
		the problem it belongs to; the grader (/api/grade) reads it that way.
	-->
	<ol class="print-problems">
		{#each data.problems as p, i (p.id)}
			{@const prev = data.problems[i - 1]}
			{#if p.section && p.section !== prev?.section}
				<li class="psection">{p.section}</li>
			{/if}
			{#if p.directions && (p.directions !== prev?.directions || p.section !== prev?.section)}
				<li class="pdirections"><ProblemText body={p.directions} /></li>
			{/if}
			<li class="pitem">
				<div class="pline">
					<span class="plabel">{p.label}.</span>
					<ProblemText body={p.body} class="pbody" />
				</div>
				<div class="pspace" style:height={space(p.work_lines)}></div>
			</li>
		{/each}
	</ol>

	<!-- ---------------------------------------------- extra ruled pages, for overflow -->
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
