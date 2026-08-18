<script lang="ts">
	import { weekLabel, addWeeks, isCurrentWeek, weekStart } from '$lib/week';
	import GoalList from '$lib/components/GoalList.svelte';

	let { data, form } = $props();

	const classesById = $derived(new Map(data.classes.map((c) => [c.id, c])));
	const goalsByClass = $derived.by(() => {
		const m = new Map<string, typeof data.goals>();
		for (const c of data.classes) m.set(c.id, []);
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
</script>

<div class="wrap stack">
	<div class="week-nav">
		<a class="btn btn-sm" href="?week={addWeeks(data.week, -1)}" aria-label="Previous week">←</a>
		<div class="center">
			<h2>{weekLabel(data.week)}</h2>
			{#if isCurrentWeek(data.week)}
				<span class="today-tag">This week</span>
			{:else}
				<a class="small" href="?week={weekStart()}">Jump to this week</a>
			{/if}
		</div>
		<a class="btn btn-sm" href="?week={addWeeks(data.week, 1)}" aria-label="Next week">→</a>
	</div>

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

	{#if !data.classes.length}
		<div class="empty">
			<h3>No classes yet</h3>
			<p>Classes are the spine of the calendar — add one to start setting weekly goals.</p>
			<a class="btn btn-primary" href="/admin/classes">Add a class</a>
		</div>
	{:else}
		<div class="grid grid-2">
			{#each data.classes as klass (klass.id)}
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
