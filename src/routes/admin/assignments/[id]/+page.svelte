<script lang="ts">
	import { weekLabel } from '$lib/week';

	let { data, form } = $props();

	type Row = {
		id: string | null;
		label: string;
		body: string;
		answer: string;
		points: number;
		included: boolean;
	};

	// Local editable copy, re-seeded whenever the server sends a fresh list.
	let rows = $state<Row[]>([]);
	let seeded = $state('');
	$effect(() => {
		const stamp = data.problems.map((p) => p.id).join(',');
		if (stamp !== seeded) {
			seeded = stamp;
			rows = data.problems.map((p) => ({
				id: p.id,
				label: p.label,
				body: p.body,
				answer: p.answer ?? '',
				points: Number(p.points ?? 1),
				included: p.included
			}));
		}
	});

	const a = $derived(data.assignment);
	const kept = $derived(rows.filter((r) => r.included).length);
	const klass = $derived(data.classes.find((c) => c.id === a.class_id));

	let showAnswers = $state(false);

	function addRow() {
		rows = [...rows, { id: null, label: String(rows.length + 1), body: '', answer: '', points: 1, included: true }];
	}
	function removeRow(i: number) {
		rows = rows.filter((_, n) => n !== i);
	}
	function move(i: number, delta: number) {
		const j = i + delta;
		if (j < 0 || j >= rows.length) return;
		const next = [...rows];
		[next[i], next[j]] = [next[j], next[i]];
		rows = next;
	}
</script>

<div class="wrap stack">
	<div class="row-between">
		<div>
			<h1>{a.title}</h1>
			<p class="muted small" style="margin:0">
				{klass?.name ?? 'No class'}
				{#if a.week_start}· {weekLabel(a.week_start)}{/if}
				· <span class="badge {a.status === 'published' ? 'badge-ok' : ''}">{a.status}</span>
			</p>
		</div>
		<div class="btn-row">
			<a class="btn" href="/admin/assignments/{a.id}/print">Print</a>
			{#if a.status === 'published'}
				<form method="POST" action="?/setStatus">
					<input type="hidden" name="status" value="draft" />
					<button class="btn" type="submit">Unpublish</button>
				</form>
			{:else}
				<form method="POST" action="?/setStatus">
					<input type="hidden" name="status" value="published" />
					<button class="btn btn-primary" type="submit">Publish</button>
				</form>
			{/if}
		</div>
	</div>

	{#if form?.message}
		<div class="alert {form.message === 'Saved.' || form.message.startsWith('Published') ? 'alert-ok' : 'alert-bad'}">
			{form.message}
		</div>
	{/if}

	<form method="POST" action="?/save" class="stack">
		<input type="hidden" name="problems" value={JSON.stringify(rows)} />

		<div class="card">
			<div class="card-head"><span class="card-title">Details</span></div>

			<div class="field">
				<label for="title">Title</label>
				<input id="title" name="title" type="text" value={a.title} required />
			</div>

			<div class="inline-form" style="margin-bottom:.9rem">
				<div class="field">
					<label for="cls">Class</label>
					<select id="cls" name="class_id" required>
						{#each data.classes as c (c.id)}
							<option value={c.id} selected={c.id === a.class_id}>{c.name}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="wk">Week</label>
					<select id="wk" name="week_start">
						<option value="" selected={!a.week_start}>Not scheduled</option>
						{#each data.weekOptions as w (w)}
							<option value={w} selected={w === a.week_start}>{weekLabel(w)}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="field">
				<label for="instructions">Instructions</label>
				<textarea id="instructions" name="instructions">{a.instructions ?? ''}</textarea>
			</div>

			<div class="inline-form">
				<div class="field">
					<label for="pen">Hint penalty (%)</label>
					<input id="pen" name="hint_penalty" type="number" min="0" max="100" value={a.hint_penalty} />
				</div>
				<div class="field">
					<label for="pages">Blank work pages</label>
					<input id="pages" name="work_pages" type="number" min="0" max="20" value={a.work_pages} />
				</div>
			</div>
		</div>

		<div class="card">
			<div class="card-head">
				<span class="card-title">Problems</span>
				<span class="card-note">{kept} of {rows.length} assigned</span>
			</div>
			<p class="hint" style="margin-bottom:.75rem">
				Uncheck anything extraneous — unchecked problems are never printed, never shown to
				students, and never graded.
			</p>

			<ul class="problem-list">
				{#each rows as r, i (i)}
					<li class="problem {r.included ? '' : 'is-excluded'}">
						<div style="display:flex;flex-direction:column;gap:.3rem;align-items:center">
							<input
								type="checkbox"
								bind:checked={r.included}
								aria-label="Include problem {r.label}"
								style="width:20px;height:20px;accent-color:var(--accent)"
							/>
							<input
								class="problem-label"
								style="width:3rem;min-height:30px;padding:.15rem .25rem;text-align:center"
								bind:value={r.label}
								aria-label="Problem number"
							/>
						</div>

						<div class="problem-body">
							<textarea bind:value={r.body} aria-label="Problem {r.label} text"></textarea>
							{#if showAnswers}
								<div class="inline-form" style="margin-top:.4rem">
									<div class="field">
										<label for="ans-{i}">Answer</label>
										<input id="ans-{i}" bind:value={r.answer} placeholder="e.g. x = 7" />
									</div>
									<div class="field" style="flex:0 1 90px">
										<label for="pts-{i}">Points</label>
										<input id="pts-{i}" type="number" min="0" step="0.5" bind:value={r.points} />
									</div>
								</div>
							{/if}
						</div>

						<div class="problem-actions">
							<button class="btn btn-ghost btn-sm" type="button" onclick={() => move(i, -1)} aria-label="Move up">↑</button>
							<button class="btn btn-ghost btn-sm" type="button" onclick={() => move(i, 1)} aria-label="Move down">↓</button>
							<button class="btn btn-ghost btn-sm" type="button" onclick={() => removeRow(i)} aria-label="Delete">×</button>
						</div>
					</li>
				{/each}
			</ul>

			<div class="btn-row" style="margin-top:.75rem">
				<button class="btn btn-sm" type="button" onclick={addRow}>+ Add a problem</button>
				<button class="btn btn-sm" type="button" onclick={() => (showAnswers = !showAnswers)}>
					{showAnswers ? 'Hide' : 'Show'} answers &amp; points
				</button>
			</div>
		</div>

		<div class="card">
			<div class="card-head">
				<span class="card-title">Answer key</span>
				<span class="card-note">Optional — grading falls back to working it out.</span>
			</div>
			<div class="field">
				<label class="sr-only" for="key">Answer key</label>
				<textarea id="key" name="answer_key" placeholder="1. x = 7&#10;2. 14 cm²">{a.answer_key ?? ''}</textarea>
			</div>
		</div>

		<div class="row-between">
			<button class="btn btn-primary" type="submit">Save changes</button>
		</div>
	</form>

	{#if data.submissions.length}
		<div class="card card-flush">
			<div style="padding:1rem 1rem .25rem"><span class="card-title">Turned in</span></div>
			<ul class="list">
				{#each data.submissions as s (s.id)}
					<li>
						<div class="list-main">
							<div class="list-title">{s.profile?.display_name ?? 'Unknown student'}</div>
							<div class="list-sub">
								{s.status}
								{#if s.status === 'graded' && s.max_score}
									· {s.score}/{s.max_score}
								{/if}
								{#if s.hint_penalty_total > 0}· {s.hint_penalty_total}% hint penalty{/if}
							</div>
						</div>
						<a class="btn btn-sm" href="/admin/submissions/{s.id}">Open</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<form
		method="POST"
		action="?/remove"
		onsubmit={(e) => {
			if (!confirm('Delete this assignment and all its problems? This cannot be undone.')) {
				e.preventDefault();
			}
		}}
	>
		<button class="btn btn-danger btn-sm" type="submit">Delete assignment</button>
	</form>
</div>
