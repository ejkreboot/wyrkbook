<script lang="ts">
	import { weekLabel } from '$lib/week';

	let { data } = $props();

	const classesById = $derived(new Map(data.classes.map((c) => [c.id, c])));

	function countOf(rel: unknown): number {
		return Array.isArray(rel) ? (rel[0]?.count ?? 0) : 0;
	}
</script>

<div class="wrap stack">
	<div class="row-between">
		<h1>Assignments</h1>
		<a class="btn btn-primary" href="/admin/assignments/new">+ New from photo</a>
	</div>

	<form method="GET" class="row">
		<select name="class" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
			<option value="">All classes</option>
			{#each data.classes as c (c.id)}
				<option value={c.id} selected={c.id === data.classFilter}>{c.name}</option>
			{/each}
		</select>
		<select name="status" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
			<option value="">Any status</option>
			{#each ['draft', 'published', 'archived'] as s}
				<option value={s} selected={s === data.statusFilter}>{s}</option>
			{/each}
		</select>
		<noscript><button class="btn btn-sm" type="submit">Filter</button></noscript>
	</form>

	{#if data.assignments.length}
		<div class="card card-flush">
			<ul class="list">
				{#each data.assignments as a (a.id)}
					{@const k = classesById.get(a.class_id)}
					{@const submissions = countOf(a.submission)}
					<li class="tagged" style="--tag: var(--c-{k?.color ?? 'slate'})">
						<div class="list-main">
							<div class="list-title">
								<a href="/admin/assignments/{a.id}">{a.title}</a>
							</div>
							<div class="list-sub">
								{k?.name ?? 'Unknown class'}
								· {countOf(a.problem)} problems
								{#if a.week_start}· {weekLabel(a.week_start)}{/if}
								{#if submissions}· {submissions} turned in{/if}
							</div>
						</div>
						<span class="badge {a.status === 'published' ? 'badge-ok' : ''}">{a.status}</span>
						<a class="btn btn-sm no-print" href="/admin/assignments/{a.id}/print">Print</a>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<div class="empty">
			<h3>No assignments yet</h3>
			<p>
				Photograph an exercise set from a textbook and wyrkbook will turn it into a printable
				assignment you can edit first.
			</p>
			<a class="btn btn-primary" href="/admin/assignments/new">+ New from photo</a>
		</div>
	{/if}
</div>
