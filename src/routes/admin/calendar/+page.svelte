<script lang="ts">
	import { monthLabel, weekLabel } from '$lib/week';
	import GoalList from '$lib/components/GoalList.svelte';

	let { data, form } = $props();

	/*
	 * `data.classIds` is the roster of the student being filtered by, or null for
	 * no filter. Everything downstream — the columns, the per-week counts, the
	 * lookup map — works off the visible set, so filtering by a student shows the
	 * month exactly as that student's week is shaped.
	 */
	const visibleClasses = $derived(
		data.classIds ? data.classes.filter((c) => data.classIds!.includes(c.id)) : data.classes
	);
	const classesById = $derived(new Map(visibleClasses.map((c) => [c.id, c])));

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
		if (data.studentFilter) p.set('student', data.studentFilter);
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

	/*
	 * One column per class, in the same order in every week, so a class can be
	 * followed straight down the month. Derived from the class list rather than
	 * from the goals present: a week where a class has nothing still needs its
	 * cell, or the columns stop lining up.
	 *
	 * `data.classes` excludes archived classes, so anything left over from one
	 * drops out of the calendar — out of the columns and out of the week's count
	 * alike. An archived class is done being taught; its goals are history.
	 */
	const visibleFor = $derived((week: string) =>
		goalsFor(week).filter((g) => classesById.has(g.class_id))
	);

	/*
	 * A month opens on the current week rather than at the top of it — by the end
	 * of May, January's weeks are not what anyone came to look at. Once per month
	 * shown, so toggling a goal does not yank the page back.
	 *
	 * The scrollY test stands aside for the browser's own scroll restoration: on
	 * a back-navigation the reader was already somewhere, and moving them is
	 * worse than not helping.
	 */
	let focused = $state('');

	$effect(() => {
		const key = `${data.year}-${data.month0}`;
		if (focused === key) return;
		focused = key;

		if (!data.weeks.includes(data.currentWeek) || window.scrollY > 4) return;
		document.getElementById('this-week')?.scrollIntoView({ block: 'start', behavior: 'instant' });
	});
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
		<label class="label" for="stu">Student</label>
		<select
			id="stu"
			name="student"
			style="max-width:220px"
			onchange={(e) => e.currentTarget.form?.requestSubmit()}
		>
			<option value="">All students</option>
			{#each data.students as s (s.id)}
				<option value={s.id} selected={s.id === data.studentFilter}>{s.display_name}</option>
			{/each}
		</select>
		<noscript><button class="btn btn-sm" type="submit">Filter</button></noscript>
	</form>

	{#if form?.message}
		<div class="alert alert-ok">{form.message}</div>
	{/if}

	<!-- One scroller around every week, not one per week: separate scrollers would
	     drift out of step and the columns would stop being columns. -->
	<div class="week-scroll">
		<div class="week-rows">
			{#each data.weeks as week (week)}
				{@const goals = visibleFor(week)}
				{@const assignments = assignmentsFor(week)}
				<div
					class="week-card {week === data.currentWeek ? 'is-current' : ''}"
					id={week === data.currentWeek ? 'this-week' : undefined}
				>
					<h4>
						<span class="stick-left">
							{weekLabel(week)}
							<span class="count">{goals.filter((g) => g.done).length}/{goals.length}</span>
						</span>
					</h4>

					{#if data.classFilter}
						<GoalList
							{goals}
							color={classesById.get(data.classFilter)?.color ?? 'slate'}
							classId={data.classFilter}
							{week}
						/>
					{:else if visibleClasses.length}
						<div class="week-cols">
							{#each visibleClasses as col (col.id)}
								{@const cg = goalsFor(week, col.id)}
								<div class="week-col">
									<span class="chip" style="--tag: var(--c-{col.color})">
										<span class="chip-dot"></span>{col.name}
									</span>
									{#if cg.length}
										<ul class="goal-list">
											{#each cg as g (g.id)}
												<li class="goal {g.done ? 'is-done' : ''}" style="--tag: var(--c-{col.color})">
													<div style="flex:1;min-width:0">
														<div class="goal-title">{g.title}</div>
														{#if g.detail}<div class="goal-detail">{g.detail}</div>{/if}
													</div>
												</li>
											{/each}
										</ul>
									{:else}
										<p class="week-col-empty">—</p>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<p class="muted small" style="margin:.35rem 0 0">
							{data.studentFilter ? 'Not enrolled in any class.' : 'No classes yet.'}
						</p>
					{/if}

					{#if assignments.length}
						<div class="stick-left" style="margin-top:.6rem;border-top:1px solid var(--line);padding-top:.5rem">
							{#each assignments as a (a.id)}
								<div class="small">
									<a href="/admin/assignments/{a.id}">{a.title}</a>
								</div>
							{/each}
						</div>
					{/if}

					<div class="stick-left" style="margin-top:.5rem">
						<a class="small muted" href="/admin?week={week}">Open week →</a>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
