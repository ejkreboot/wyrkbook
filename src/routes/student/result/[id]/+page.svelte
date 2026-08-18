<script lang="ts">
	let { data } = $props();

	const s = $derived(data.submission);
	const right = $derived(data.results.filter((r) => r.correct).length);
	const percent = $derived(s.max_score ? Math.round((s.score / s.max_score) * 100) : 0);
</script>

<div class="wrap wrap-narrow stack">
	<div>
		<h1>{s.assignment?.title}</h1>
		<p class="muted small" style="margin:0">Graded</p>
	</div>

	<div class="card row-between">
		<div>
			<div class="score">{percent}%</div>
			<div class="score-sub">{s.score} of {s.max_score} points</div>
		</div>
		<div style="text-align:right">
			<div class="badge badge-ok">{right} of {data.results.length} right</div>
			{#if s.hint_penalty_total > 0}
				<div class="penalty-note" style="margin-top:.35rem">
					−{s.hint_penalty_total}% for {data.hints.length} hint{data.hints.length === 1 ? '' : 's'}
				</div>
			{/if}
		</div>
	</div>

	{#if s.feedback}
		<div class="card">
			<div class="label">From your grader</div>
			<p style="margin:.3rem 0 0;white-space:pre-wrap">{s.feedback}</p>
		</div>
	{/if}

	<div class="card">
		<div class="card-head"><span class="card-title">Problem by problem</span></div>
		<ul class="problem-list">
			{#each data.results as r (r.id)}
				<li class="problem" style="border-left:3px solid {r.correct ? 'var(--ok)' : 'var(--bad)'}">
					<div class="problem-label">{r.problem?.label}</div>
					<div class="problem-body">
						<div class="small">{r.problem?.body}</div>
						{#if r.student_work}
							<div class="answer-line">
								<strong>You wrote:</strong> <span class="mono">{r.student_work}</span>
							</div>
						{/if}
						{#if r.feedback}
							<div class="answer-line">{r.feedback}</div>
						{/if}
					</div>
					<div class="problem-actions">
						<span class="badge {r.correct ? 'badge-ok' : 'badge-bad'}">
							{r.correct ? '✓' : '✗'}
						</span>
					</div>
				</li>
			{/each}
		</ul>
	</div>

	<a class="btn btn-block" href="/student">Back to my work</a>
</div>
