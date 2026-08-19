<script lang="ts">
	import { monthLabel, weekLabel } from '$lib/week';
	import GoalList from '$lib/components/GoalList.svelte';

	let { data, form } = $props();

	const classesById = $derived(new Map(data.classes.map((c) => [c.id, c])));

	const prev = $derived(
		data.month0 === 0
			? { y: data.year - 1, m: 11 }
			: { y: data.year, m: data.month0 - 1 }
	);
	const next = $derived(
		data.month0 === 11
			? { y: data.year + 1, m: 0 }
			: { y: data.year, m: data.month0 + 1 }
	);

	function qs(y: number, m: number) {
		const p = new URLSearchParams({ y: String(y), m: String(m) });
		if (data.classFilter) p.set('class', data.classFilter);
		return `?${p}`;
	}

	/*
	 * Grouped by class before anything else. The server returns goals ordered by
	 * sort_order, which is scoped to a single class-week — so across classes it
	 * interleaves them and a mixed week reads as a jumble. Within a class the
	 * teacher's own ordering is kept, with the title as a stable tiebreak.
	 */
	const goalsFor = $derived((week: string, classId?: string) =>
		data.goals
			.filter((g) => g.week_start === week && (!classId || g.class_id === classId))
			.sort((a, b) => {
				const an = classesById.get(a.class_id)?.name ?? '';
				const bn = classesById.get(b.class_id)?.name ?? '';
				return (
					an.localeCompare(bn) ||
					a.sort_order - b.sort_order ||
					a.title.localeCompare(b.title)
				);
			})
	);
	const assignmentsFor = $derived((week: string) =>
		data.assignments.filter((a) => a.week_start === week)
	);
</script>

<div class="wrap stack">
	<div class="week-nav">
		<a class="btn btn-sm" href={qs(prev.y, prev.m)} aria-label="Previous month">←</a>
		<h2>{monthLabel(data.year, data.month0)}</h2>
		<a class="btn btn-sm" href={qs(next.y, next.m)} aria-label="Next month">→</a>
	</div>

	<form method="GET" class="row">
		<input type="hidden" name="y" value={data.year} />
		<input type="hidden" name="m" value={data.month0} />
		<label class="label" for="cls">Class</label>
		<select
			id="cls"
			name="class"
			style="max-width:220px"
			onchange={(e) => e.currentTarget.form?.requestSubmit()}
		>
			<option value="">All classes</option>
			{#each data.classes as c (c.id)}
				<option value={c.id} selected={c.id === data.classFilter}>{c.name}</option>
			{/each}
		</select>
		<noscript><button class="btn btn-sm" type="submit">Filter</button></noscript>
	</form>

	{#if form?.message}
		<div class="alert alert-ok">{form.message}</div>
	{/if}

	<div class="week-strip">
		{#each data.weeks as week (week)}
			{@const goals = goalsFor(week)}
			{@const assignments = assignmentsFor(week)}
			<div class="week-card {week === data.currentWeek ? 'is-current' : ''}">
				<h4>
					{weekLabel(week)}
					<span class="count">{goals.filter((g) => g.done).length}/{goals.length}</span>
				</h4>

				{#if data.classFilter}
					<GoalList
						{goals}
						color={classesById.get(data.classFilter)?.color ?? 'slate'}
						classId={data.classFilter}
						{week}
					/>
				{:else}
					<ul class="goal-list">
						{#each goals as g (g.id)}
							{@const k = classesById.get(g.class_id)}
							<li class="goal {g.done ? 'is-done' : ''}" style="--tag: var(--c-{k?.color ?? 'slate'})">
								<div style="flex:1;min-width:0">
									<div class="goal-title">{g.title}</div>
									<div class="goal-detail">{k?.name ?? 'Unknown class'}</div>
								</div>
							</li>
						{/each}
					</ul>
					{#if !goals.length}
						<p class="muted small" style="margin:.35rem 0 0">No goals set.</p>
					{/if}
				{/if}

				{#if assignments.length}
					<div style="margin-top:.6rem;border-top:1px solid var(--line);padding-top:.5rem">
						{#each assignments as a (a.id)}
							<div class="small">
								<a href="/admin/assignments/{a.id}">{a.title}</a>
							</div>
						{/each}
					</div>
				{/if}

				<div style="margin-top:.5rem">
					<a class="small muted" href="/admin?week={week}">Open week →</a>
				</div>
			</div>
		{/each}
	</div>
</div>
