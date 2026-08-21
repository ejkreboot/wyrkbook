<script lang="ts">
	import { courseTotal } from '$lib/gradeGrid';

	let { data } = $props();

	const gradeFor = $derived(new Map(data.grades.map((g) => [g.grade_item_id, g])));

	/*
	 * Only classes that actually have columns. RLS has already narrowed the items
	 * to this student, so a class with none is one they are on but which has
	 * nothing worth points yet — an empty card would say nothing.
	 */
	const boards = $derived(
		data.classes
			.map((c) => ({ klass: c, items: data.items.filter((i) => i.class_id === c.id) }))
			.filter((b) => b.items.length)
	);

	// Same thresholds the Finished page uses, so a percentage means one thing.
	const band = (p: number) => (p >= 80 ? 'badge-ok' : p >= 60 ? 'badge-warn' : 'badge-bad');
</script>

<div class="wrap stack" style="padding-block:1.25rem">
	<h1>Grades</h1>

	{#if !boards.length}
		<div class="empty">
			<h3>Nothing marked yet</h3>
			<p class="muted">Grades show up here as your teacher records them.</p>
		</div>
	{/if}

	{#each boards as { klass, items } (klass.id)}
		{@const total = courseTotal(items, (id) => gradeFor.get(id)?.points_earned ?? null)}
		<div class="card card-flush tagged" style="--tag: var(--c-{klass.color})">
			<div class="card-head" style="padding:.85rem 1rem 0">
				<span class="card-title">{klass.name}</span>
				{#if total}
					<span class="score">{total.percent}%</span>
					<span class="score-sub">{total.earned} / {total.possible} points</span>
				{:else}
					<span class="card-note">nothing marked yet</span>
				{/if}
			</div>

			{#if total}
				<div class="progress" style="margin:.6rem 1rem 0">
					<span style="width:{Math.min(100, total.percent)}%"></span>
				</div>
			{/if}

			<ul class="list" style="margin-top:.6rem">
				{#each items as item (item.id)}
					{@const g = gradeFor.get(item.id)}
					{@const marked = g && g.points_earned !== null}
					<li>
						<div class="list-main">
							<div class="list-title">{item.title}</div>
							<div class="list-sub">
								{#if marked}
									{g.points_earned} / {item.points_possible} points
								{:else}
									out of {item.points_possible} · not graded yet
								{/if}
							</div>
						</div>
						{#if marked}
							{@const p = Math.round((g.points_earned / item.points_possible) * 100)}
							<span class="badge {band(p)}">{p}%</span>
						{:else}
							<span class="muted">—</span>
						{/if}
						{#if g?.submission_id}
							<a class="btn btn-ghost btn-sm" href="/student/result/{g.submission_id}">See</a>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</div>
