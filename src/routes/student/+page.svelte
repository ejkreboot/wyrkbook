<script lang="ts">
	import { weekLabel } from '$lib/week';

	let { data } = $props();

	const classesById = $derived(new Map(data.classes.map((c) => [c.id, c])));
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
				<h3>Nothing waiting</h3>
				<p>New assignments show up here once your teacher publishes them.</p>
			</div>
		{/if}
	</div>

	<p class="muted small center">
		Tip: scan the QR code on a printed sheet to jump straight to that assignment.
	</p>
</div>
