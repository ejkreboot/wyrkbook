<script lang="ts">
	let { data, form } = $props();

	const s = $derived(data.submission);
	const percent = $derived(s.max_score ? Math.round(((s.score ?? 0) / s.max_score) * 100) : 0);
	let lightbox = $state<string | null>(null);
</script>

<div class="wrap stack">
	<div class="row-between">
		<div>
			<h1>{s.assignment?.title}</h1>
			<p class="muted small" style="margin:0">
				{s.profile?.display_name} · {s.status}
			</p>
		</div>
		<a class="btn btn-ghost btn-sm" href="/admin/assignments/{s.assignment_id}">Assignment</a>
	</div>

	{#if form?.message}
		<div class="alert alert-ok">{form.message}</div>
	{/if}

	<div class="card row-between">
		<div>
			<div class="score">{percent}%</div>
			<div class="score-sub">{s.score ?? 0} of {s.max_score ?? 0} points</div>
		</div>
		{#if s.hint_penalty_total > 0}
			<div class="penalty-note">
				−{s.hint_penalty_total}% from {data.hints.length} hint{data.hints.length === 1 ? '' : 's'}
			</div>
		{/if}
	</div>

	{#if data.pageUrls.length}
		<div class="card">
			<div class="card-head"><span class="card-title">Their pages</span></div>
			<div class="thumb-grid">
				{#each data.pageUrls as url, i (url)}
					<button class="thumb" type="button" onclick={() => (lightbox = url)} aria-label="Enlarge page {i + 1}">
						<img src={url} alt="Page {i + 1}" />
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if data.hints.length}
		<div class="card stack-s">
			<div class="card-title">Hints given</div>
			{#each data.hints as h (h.id)}
				<div class="hint-card">
					<h4>−{h.penalty}%{#if h.question} · asked: "{h.question}"{/if}</h4>
					<div style="white-space:pre-wrap">{h.hint}</div>
				</div>
			{/each}
		</div>
	{/if}

	<form method="POST" action="?/save" class="stack">
		<div class="card">
			<div class="card-head">
				<span class="card-title">Marks</span>
				<span class="card-note">Untick or tick to override the AI.</span>
			</div>
			<ul class="problem-list">
				{#each data.results as r (r.id)}
					<li class="problem" style="border-left:3px solid {r.correct ? 'var(--ok)' : 'var(--bad)'}">
						<div class="problem-label">{r.problem?.label}</div>
						<div class="problem-body">
							<div class="small">{r.problem?.body}</div>
							{#if r.problem?.answer}
								<div class="answer-line"><strong>Key:</strong> {r.problem.answer}</div>
							{/if}
							{#if r.student_work}
								<div class="answer-line">
									<strong>They wrote:</strong> <span class="mono">{r.student_work}</span>
								</div>
							{/if}
							{#if r.feedback}
								<div class="answer-line muted">{r.feedback}</div>
							{/if}
						</div>
						<div class="problem-actions">
							<label class="check" title="Correct">
								<input type="checkbox" name="correct:{r.id}" checked={r.correct} />
								<span class="sr-only">Problem {r.problem?.label} correct</span>
							</label>
						</div>
					</li>
				{/each}
			</ul>
		</div>

		<div class="card">
			<div class="field">
				<label for="fb">Feedback to the student</label>
				<textarea id="fb" name="feedback">{s.feedback ?? ''}</textarea>
			</div>
			<button class="btn btn-primary" type="submit">Save grade</button>
		</div>
	</form>
</div>

{#if lightbox}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		style="position:fixed;inset:0;background:rgba(36,31,26,.9);z-index:100;display:flex;align-items:center;justify-content:center;padding:1rem"
		onclick={() => (lightbox = null)}
	>
		<img src={lightbox} alt="Student work, enlarged" style="max-width:100%;max-height:100%;object-fit:contain" />
	</div>
{/if}
