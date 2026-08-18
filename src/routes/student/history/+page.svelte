<script lang="ts">
	let { data } = $props();

	function percent(s: { score: number | null; max_score: number | null }) {
		return s.max_score ? Math.round(((s.score ?? 0) / s.max_score) * 100) : 0;
	}
</script>

<div class="wrap stack">
	<h1>Finished</h1>

	{#if data.submissions.length}
		<div class="card card-flush">
			<ul class="list">
				{#each data.submissions as s (s.id)}
					<li>
						<div class="list-main">
							<div class="list-title">{s.assignment?.title}</div>
							<div class="list-sub">
								{s.score} / {s.max_score} points
								{#if s.hint_penalty_total > 0}· −{s.hint_penalty_total}% hints{/if}
							</div>
						</div>
						<span class="badge {percent(s) >= 80 ? 'badge-ok' : percent(s) >= 60 ? 'badge-warn' : 'badge-bad'}">
							{percent(s)}%
						</span>
						<a class="btn btn-sm" href="/student/result/{s.id}">See</a>
					</li>
				{/each}
			</ul>
		</div>
	{:else}
		<div class="empty">
			<h3>Nothing finished yet</h3>
			<p>Assignments show up here once they're graded.</p>
		</div>
	{/if}
</div>
