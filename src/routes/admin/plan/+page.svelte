<script lang="ts">
	import { weekLabel, addWeeks, weekStart } from '$lib/week';

	let { data, form } = $props();

	// One text box per week, goals one per line. Re-seeded whenever the server
	// sends a different class or week range.
	let boxes = $state<Record<string, string>>({});
	let seeded = $state('');

	$effect(() => {
		const stamp = `${data.classId}:${data.start}:${data.count}:${data.goals.length}`;
		if (stamp === seeded) return;
		seeded = stamp;

		const next: Record<string, string> = {};
		for (const w of data.weeks) next[w] = '';
		for (const g of data.goals) {
			next[g.week_start] = next[g.week_start] ? `${next[g.week_start]}\n${g.title}` : g.title;
		}
		boxes = next;
	});

	const klass = $derived(data.classes.find((c) => c.id === data.classId));

	const payload = $derived(
		data.weeks.map((w) => ({
			week_start: w,
			lines: (boxes[w] ?? '').split('\n')
		}))
	);

	const totalGoals = $derived(
		payload.reduce((n, w) => n + w.lines.filter((l) => l.trim()).length, 0)
	);

	function lineCount(text: string) {
		return (text ?? '').split('\n').length;
	}

	/** Enter inside a box should make another goal, not submit the form. */
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			(e.currentTarget as HTMLElement).closest('form')?.requestSubmit();
		}
	}

	const startOptions = $derived(
		Array.from({ length: 14 }, (_, i) => addWeeks(weekStart(), i - 4))
	);
</script>

<div class="wrap stack">
	<div class="row-between">
		<div>
			<h1>Plan a term</h1>
			<p class="muted small" style="margin:0">
				One box per week, one goal per line. Paste a whole column from a spreadsheet if you have one.
			</p>
		</div>
	</div>

	<!-- Class and range live in the URL so a plan view is linkable and reloadable. -->
	<form method="GET" class="card row" style="gap:.75rem">
		<div class="field" style="flex:1 1 200px;margin:0">
			<label for="cls">Class</label>
			<select id="cls" name="class" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				{#each data.classes as c (c.id)}
					<option value={c.id} selected={c.id === data.classId}>{c.name}</option>
				{/each}
			</select>
		</div>
		<div class="field" style="flex:1 1 170px;margin:0">
			<label for="start">Starting</label>
			<select id="start" name="start" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				{#each startOptions as w (w)}
					<option value={w} selected={w === data.start}>{weekLabel(w)}</option>
				{/each}
			</select>
		</div>
		<div class="field" style="flex:0 1 120px;margin:0">
			<label for="weeks">Weeks</label>
			<select id="weeks" name="weeks" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				{#each [6, 12, 18, 24, 36, 40, 52] as n}
					<option value={n} selected={n === data.count}>{n}</option>
				{/each}
			</select>
		</div>
		<noscript><button class="btn btn-sm" type="submit">Go</button></noscript>
	</form>

	{#if form?.message}
		<div class="alert {form.message.startsWith('Saved') ? 'alert-ok' : 'alert-bad'}">
			{form.message}
		</div>
	{/if}

	{#if !data.classes.length}
		<div class="empty">
			<h3>No classes yet</h3>
			<p>Add a class before planning a term.</p>
			<a class="btn btn-primary" href="/admin/classes">Add a class</a>
		</div>
	{:else}
		<form method="POST" action="?/save">
			<input type="hidden" name="class_id" value={data.classId} />
			<input type="hidden" name="weeks" value={JSON.stringify(payload)} />

			<div class="plan-head">
				<span class="chip" style="--tag: var(--c-{klass?.color ?? 'slate'})">
					<span class="chip-dot"></span>{klass?.name}
				</span>
				<span class="muted small">{totalGoals} goals across {data.count} weeks</span>
				<div class="spacer"></div>
				<button class="btn btn-primary btn-sm" type="submit">Save plan</button>
			</div>

			<ul class="plan-list">
				{#each data.weeks as w (w)}
					<li class="plan-week {w === data.currentWeek ? 'is-current' : ''}">
						<div class="plan-when">
							<span class="plan-date">{weekLabel(w)}</span>
							{#if w === data.currentWeek}<span class="plan-now">this week</span>{/if}
						</div>
						<textarea
							class="plan-box"
							bind:value={boxes[w]}
							rows={Math.max(3, lineCount(boxes[w]) + 1)}
							onkeydown={onKeydown}
							placeholder="one goal per line…"
							aria-label="Goals for week of {weekLabel(w)}"
						></textarea>
					</li>
				{/each}
			</ul>

			<div class="plan-foot">
				<span class="muted small">⌘/Ctrl + Enter saves from any box.</span>
				<div class="spacer"></div>
				<button class="btn btn-primary" type="submit">Save plan</button>
			</div>
		</form>
	{/if}
</div>
