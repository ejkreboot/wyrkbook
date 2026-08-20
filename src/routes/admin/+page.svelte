<script lang="ts">
	import { weekLabel, addWeeks, isCurrentWeek, weekStart } from '$lib/week';
	import GoalList from '$lib/components/GoalList.svelte';

	let { data, form } = $props();

	/*
	 * `data.classIds` is the roster of the student being filtered by, or null for
	 * no filter. Filtering narrows which class cards appear, so the week reads as
	 * that one student's week rather than the whole school's.
	 */
	const visibleClasses = $derived(
		data.classIds ? data.classes.filter((c) => data.classIds!.includes(c.id)) : data.classes
	);

	const goalsByClass = $derived.by(() => {
		const m = new Map<string, typeof data.goals>();
		for (const c of visibleClasses) m.set(c.id, []);
		for (const g of data.goals) {
			if (!m.has(g.class_id)) m.set(g.class_id, []);
			m.get(g.class_id)!.push(g);
		}
		return m;
	});

	const assignmentsByClass = $derived.by(() => {
		const m = new Map<string, typeof data.assignments>();
		for (const a of data.assignments) {
			if (!m.has(a.class_id)) m.set(a.class_id, []);
			m.get(a.class_id)!.push(a);
		}
		return m;
	});

	const done = $derived(data.goals.filter((g) => g.done).length);

	/** Week links have to carry the student filter or paging silently clears it. */
	function qs(week: string) {
		const p = new URLSearchParams({ week });
		if (data.studentFilter) p.set('student', data.studentFilter);
		return `?${p}`;
	}
</script>

<div class="wrap stack">
	<div class="week-nav">
		<a class="btn btn-sm" href={qs(addWeeks(data.week, -1))} aria-label="Previous week">←</a>
		<div class="center">
			<h2>{weekLabel(data.week)}</h2>
			{#if isCurrentWeek(data.week)}
				<span class="today-tag">This week</span>
			{:else}
				<a class="small" href={qs(weekStart())}>Jump to this week</a>
			{/if}
		</div>
		<a class="btn btn-sm" href={qs(addWeeks(data.week, 1))} aria-label="Next week">→</a>
	</div>

	{#if data.students.length}
		<form method="GET" class="row">
			<input type="hidden" name="week" value={data.week} />
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
	{/if}

	{#if form?.message}
		<div class="alert alert-ok">{form.message}</div>
	{/if}

	{#if data.goals.length}
		<div class="card row-between">
			<div>
				<div class="score">{done}<span class="muted" style="font-size:1rem">/{data.goals.length}</span></div>
				<div class="score-sub">goals met this week</div>
			</div>
			<div style="flex:1;min-width:140px">
				<div class="progress">
					<span style="width:{data.goals.length ? (done / data.goals.length) * 100 : 0}%"></span>
				</div>
			</div>
		</div>
	{/if}

	{#if data.needsGrading.length}
		<div class="card" style="border-left:4px solid var(--warn)">
			<div class="card-head">
				<span class="card-title">Waiting to be graded</span>
				<span class="badge badge-warn">{data.needsGrading.length}</span>
			</div>
			<ul class="list">
				{#each data.needsGrading as s (s.id)}
					<li style="padding-left:0;padding-right:0">
						<div class="list-main">
							<div class="list-title">{s.assignment?.title}</div>
							<div class="list-sub">{s.profile?.display_name}</div>
						</div>
						<a class="btn btn-sm" href="/admin/submissions/{s.id}">Grade</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if !visibleClasses.length}
		<div class="empty">
			{#if data.studentFilter}
				<h3>Not enrolled in any class</h3>
				<p>Put this student on a roster and their week fills in here.</p>
				<a class="btn btn-primary" href="/admin/students">Manage rosters</a>
			{:else}
				<h3>No classes yet</h3>
				<p>Classes are the spine of the calendar — add one to start setting weekly goals.</p>
				<a class="btn btn-primary" href="/admin/classes">Add a class</a>
			{/if}
		</div>
	{:else}
		<div class="grid grid-2">
			{#each visibleClasses as klass (klass.id)}
				<div class="card tagged" style="--tag: var(--c-{klass.color})">
					<div class="card-head">
						<span class="card-title">{klass.name}</span>
						{#if klass.subject}<span class="chip" style="--tag: var(--c-{klass.color})">{klass.subject}</span>{/if}
					</div>

					<GoalList
						goals={goalsByClass.get(klass.id) ?? []}
						color={klass.color}
						classId={klass.id}
						week={data.week}
					/>

					{#if (assignmentsByClass.get(klass.id) ?? []).length}
						<div style="margin-top:.85rem">
							<div class="label" style="margin-bottom:.35rem">Assignments this week</div>
							<ul class="stack-s" style="list-style:none;padding:0;margin:0">
								{#each assignmentsByClass.get(klass.id) ?? [] as a (a.id)}
									<li class="row" style="gap:.4rem">
										<a href="/admin/assignments/{a.id}" class="small">{a.title}</a>
										<span class="badge {a.status === 'published' ? 'badge-ok' : ''}">{a.status}</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
