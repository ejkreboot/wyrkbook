<script lang="ts">
	import { weekLabel } from '$lib/week';

	let { data } = $props();

	const classesById = $derived(new Map(data.classes.map((c) => [c.id, c])));

	/*
	 * The student's own classes, in the order the class list came back. Derived
	 * from the roster rather than from the goals present, so a class with nothing
	 * set this week still gets its heading — "nothing due" and "not my class" are
	 * different answers and should not look the same.
	 */
	const myClasses = $derived(
		data.classes.filter((c) => data.myClassIds.includes(c.id))
	);

	const goalsByClass = $derived.by(() => {
		const m = new Map<string, typeof data.goals>();
		for (const g of data.goals) {
			if (!m.has(g.class_id)) m.set(g.class_id, []);
			m.get(g.class_id)!.push(g);
		}
		return m;
	});

	const started = $derived(
		data.assignments.filter((a) => data.submissionByAssignment[a.id]?.status === 'in_progress')
	);
	const notStarted = $derived(data.assignments.filter((a) => !data.submissionByAssignment[a.id]));
	const waiting = $derived(
		data.assignments.filter((a) => data.submissionByAssignment[a.id]?.status === 'submitted')
	);
</script>

<div class="wrap stack">
	<h1>My work</h1>

	{#if myClasses.length}
		<div>
			<h2 style="margin-bottom:.6rem">This week · {weekLabel(data.thisWeek)}</h2>
			<div class="grid grid-2">
				{#each myClasses as k (k.id)}
					{@const goals = goalsByClass.get(k.id) ?? []}
					<div class="card tagged" style="--tag: var(--c-{k.color})">
						<div class="card-head"><span class="card-title">{k.name}</span></div>
						{#if goals.length}
							<!-- Read-only: `done` is the teacher's tracker, and students have no
							     update policy on weekly_goal to tick it with. -->
							<ul class="goal-list">
								{#each goals as g (g.id)}
									<li class="goal {g.done ? 'is-done' : ''}" style="--tag: var(--c-{k.color})">
										<span aria-hidden="true" style="color:var(--ink-3)">{g.done ? '☑' : '☐'}</span>
										<div style="flex:1;min-width:0">
											<div class="goal-title">{g.title}</div>
											{#if g.detail}<div class="goal-detail">{g.detail}</div>{/if}
										</div>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="muted small" style="margin:0">Nothing set this week.</p>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if started.length}
		<div>
			<h2 style="margin-bottom:.6rem">In progress</h2>
			<div class="stack-s">
				{#each started as a (a.id)}
					{@const k = classesById.get(a.class_id)}
					{@const s = data.submissionByAssignment[a.id]}
					<a
						class="card tagged row-between"
						style="--tag: var(--c-{k?.color ?? 'slate'}); text-decoration:none; color:inherit"
						href="/student/a/{a.id}"
					>
						<div>
							<div class="card-title">{a.title}</div>
							<div class="card-note">
								{k?.name ?? ''}
								{#if a.week_start}· {weekLabel(a.week_start)}{/if}
								{#if s?.hint_penalty_total > 0}
									· <span class="penalty-note">−{s.hint_penalty_total}% from hints</span>
								{/if}
							</div>
						</div>
						<span class="btn btn-primary btn-sm">Continue</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	{#if waiting.length}
		<div>
			<h2 style="margin-bottom:.6rem">Turned in</h2>
			<div class="stack-s">
				{#each waiting as a (a.id)}
					<div class="card row-between">
						<div>
							<div class="card-title">{a.title}</div>
							<div class="card-note">Waiting on your teacher.</div>
						</div>
						<span class="badge badge-warn">submitted</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div>
		<h2 style="margin-bottom:.6rem">Available</h2>
		{#if notStarted.length}
			<div class="stack-s">
				{#each notStarted as a (a.id)}
					{@const k = classesById.get(a.class_id)}
					<a
						class="card tagged row-between"
						style="--tag: var(--c-{k?.color ?? 'slate'}); text-decoration:none; color:inherit"
						href="/s/{a.id}"
					>
						<div>
							<div class="card-title">{a.title}</div>
							<div class="card-note">
								{k?.name ?? ''}
								{#if a.week_start}· {weekLabel(a.week_start)}{/if}
							</div>
						</div>
						<span class="btn btn-sm">Start</span>
					</a>
				{/each}
			</div>
		{:else}
			<div class="empty">
				{#if myClasses.length}
					<h3>Nothing waiting</h3>
					<p>New assignments show up here once your teacher publishes them.</p>
				{:else}
					<h3>No classes yet</h3>
					<p>Your teacher has not added you to a class. Work appears here once they do.</p>
				{/if}
			</div>
		{/if}
	</div>

	<p class="muted small center">
		Tip: scan the QR code on a printed sheet to jump straight to that assignment.
	</p>
</div>
