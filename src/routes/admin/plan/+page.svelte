<script lang="ts">
	import { weekLabel, addWeeks, weekStart } from '$lib/week';

	let { data, form } = $props();

	type ImportedWeek = { week_start: string; lines: string[] };

	// One text box per week, goals one per line. Re-seeded whenever the server
	// sends a different class or week range.
	let boxes = $state<Record<string, string>>({});
	let seeded = $state('');

	// The visible week list starts as the server's range but the file importer
	// can push it past the end — "spread this over 40 weeks" should not be
	// silently truncated to the 18 the page happened to open with.
	let weeks = $state<string[]>([]);

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
		weeks = [...data.weeks];
		adoptServerJob();
	});

	const klass = $derived(data.classes.find((c) => c.id === data.classId));

	const payload = $derived(
		weeks.map((w) => ({
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

	// The server widens the range to cover an existing plan, so the current count
	// is often not one of the presets — fold it in rather than showing a blank.
	const weekChoices = $derived(
		[...new Set([6, 12, 18, 24, 36, 40, 52, data.count])].sort((a, b) => a - b)
	);

	// ------------------------------------------------------------ file import
	//
	// The read is a job on the server, not a held-open request: the upload
	// answers in about a second and the model call carries on behind it. So this
	// half is a poller, and everything it needs to resume lives in the row —
	// closing the tab mid-read loses nothing.

	const MAX_BYTES = 4 * 1024 * 1024; // mirrors UPLOAD_MAX_BYTES; Vercel caps a body at 4.5 MB

	let file = $state<File | null>(null);
	let guidance = $state('');
	let importError = $state('');
	let importNotes = $state('');

	// What the server last handed us, so a guidance box the teacher has since
	// edited is never clobbered by a reload — see adoptServerJob().
	let guidanceSeed = $state('');
	let lastFile = $state('');

	// Two-way bound rather than derived from state: an `open={...}` attribute
	// would slam the panel shut on the teacher whenever anything else re-rendered.
	let panelOpen = $state(false);

	let jobId = $state('');
	let jobStatus = $state<'idle' | 'running' | 'ready' | 'failed'>('idle');
	let jobFile = $state('');
	let waited = $state(0);

	// A plan that finished while the teacher was elsewhere. Offered rather than
	// applied, because the boxes below may hold edits they have not saved.
	let offered = $state<{ id: string; file_name: string; notes: string; weeks: ImportedWeek[] } | null>(
		null
	);

	const busy = $derived(jobStatus === 'running');

	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(timer));

	/**
	 * Picks up whatever the server says is in flight, waiting, or last read for
	 * this class — including the guidance that produced it, so a plan that came
	 * out paced wrong can be argued with rather than retyped from scratch.
	 */
	function adoptServerJob() {
		clearTimeout(timer);
		importError = '';
		importNotes = '';
		offered = null;
		jobId = '';
		jobStatus = 'idle';

		const p = data.pendingImport;

		/*
		 * Follow the server only while the box is untouched. A save reloads the
		 * page, and typed-but-not-yet-run guidance surviving that reload is the
		 * whole point of editing it.
		 */
		const stored = p?.guidance ?? '';
		if (guidance === guidanceSeed) guidance = stored;
		guidanceSeed = stored;
		lastFile = p?.file_name ?? '';

		if (!p) return;

		jobFile = p.file_name;
		if (p.status === 'running') {
			jobId = p.id;
			jobStatus = 'running';
			waited = 0;
			timer = setTimeout(poll, 3000);
		} else if (p.status === 'ready') {
			offered = { id: p.id, file_name: p.file_name, notes: p.notes, weeks: p.weeks };
		} else if (p.status === 'failed') {
			importError = p.error || 'The read did not finish.';
			panelOpen = true;
		}
	}

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const picked = input.files?.[0] ?? null;
		importError = '';
		if (picked && picked.size > MAX_BYTES) {
			file = null;
			input.value = '';
			importError = `${picked.name} is ${(picked.size / 1024 / 1024).toFixed(1)} MB. The limit is 4 MB — a lesson list or syllabus, not a whole textbook.`;
			return;
		}
		file = picked;
	}

	async function startImport() {
		if (!file || busy) return;
		importError = '';
		importNotes = '';
		offered = null;
		waited = 0;

		try {
			const body = new FormData();
			body.append('file', file);
			body.append('guidance', guidance);
			body.append('start', data.start);
			body.append('class_id', data.classId);
			body.append('class_name', klass?.name ?? '');

			const res = await fetch('/api/plan-import', { method: 'POST', body });
			if (!res.ok) {
				importError = tidyError(await res.text(), res.status);
				return;
			}
			const started = await res.json();
			jobId = started.id;
			jobFile = file.name;
			jobStatus = 'running';
			timer = setTimeout(poll, 3000);
		} catch {
			importError = 'The upload failed. Check your connection and try again.';
		}
	}

	async function poll() {
		if (!jobId) return;
		waited += 3;
		try {
			const res = await fetch(`/api/plan-import/${jobId}`);
			if (!res.ok) {
				jobStatus = 'failed';
				importError = tidyError(await res.text(), res.status);
				return;
			}
			const job = await res.json();

			if (job.status === 'running') {
				timer = setTimeout(poll, 3000);
				return;
			}
			if (job.status === 'failed') {
				jobStatus = 'failed';
				importError = job.error || 'The read did not finish.';
				panelOpen = true;
				return;
			}
			// The teacher started this one and is still here, so apply it rather
			// than making them click a second time.
			jobStatus = 'ready';
			lastFile = job.file_name || lastFile;
			applyPlan(job.weeks, job.notes);
			markApplied(job.id);
		} catch {
			// A dropped poll is not a dropped job — the row is on the server.
			timer = setTimeout(poll, 5000);
		}
	}

	function acceptOffer() {
		if (!offered) return;
		applyPlan(offered.weeks, offered.notes);
		markApplied(offered.id);
		offered = null;
	}

	async function markApplied(id: string) {
		try {
			await fetch(`/api/plan-import/${id}`, { method: 'POST' });
		} catch {
			// Cosmetic only: the row would just be offered again on the next visit.
		}
	}

	/**
	 * A read replaces the plan rather than merging into it: half of one term's
	 * boxes interleaved with another's is nobody's plan. Still nothing saved —
	 * this only fills the text boxes.
	 */
	function applyPlan(imported: ImportedWeek[], notes: string) {
		const next: Record<string, string> = {};
		for (const w of weeks) next[w] = '';
		const nextWeeks = new Set(weeks);
		for (const w of imported) {
			nextWeeks.add(w.week_start);
			next[w.week_start] = w.lines.join('\n');
		}
		weeks = [...nextWeeks].sort();
		boxes = next;
		importNotes = notes;
	}

	/** SvelteKit `error()` responses are JSON; fall back to the raw text. */
	function tidyError(text: string, status: number) {
		try {
			return JSON.parse(text).message ?? `Request failed (${status}).`;
		} catch {
			return text.slice(0, 200) || `Request failed (${status}).`;
		}
	}
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
				{#each weekChoices as n (n)}
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
		{#if offered}
			<!-- Finished while the teacher was somewhere else. -->
			<div class="alert alert-ok row-between">
				<span>
					A plan read from <strong>{offered.file_name}</strong> is ready —
					{offered.weeks.length} weeks.
				</span>
				<span class="row" style="gap:.4rem">
					<button class="btn btn-sm btn-primary" type="button" onclick={acceptOffer}>
						Fill the boxes
					</button>
					<button class="btn btn-sm btn-ghost" type="button" onclick={() => (offered = null)}>
						Not now
					</button>
				</span>
			</div>
		{/if}

		{#if busy}
			<!-- Outside the fold-away panel: the teacher can navigate off this page
			     and the read carries on regardless, so say so where it is visible. -->
			<div class="alert alert-warn row">
				<span class="spinner"></span>
				<span>
					Reading <strong>{jobFile}</strong> — this takes a minute or two. You can close this page;
					the plan will be waiting here when you come back.
					{#if waited > 15}<span class="muted small">({waited}s)</span>{/if}
				</span>
			</div>
		{/if}

		<!-- Folded away by default: most visits are edits to a plan that already
		     exists, and only the first visit starts from the publisher's PDF. -->
		<details class="card import-panel" bind:open={panelOpen}>
			<summary>
				<span class="card-title">Start from a file</span>
				{#if lastFile}
					<span class="card-note">Last read from <strong>{lastFile}</strong> — guidance kept.</span>
				{:else}
					<span class="card-note">Lesson list, syllabus or schedule — PDF, text or a photo.</span>
				{/if}
			</summary>

			<div class="stack-s" style="margin-top:.9rem">
				<label class="btn btn-capture" for="plan-file">
					<span class="big">📄</span>
					<span>{file ? file.name : 'Choose a file'}</span>
					<span class="hint">PDF, TXT, CSV, or JPEG/PNG/WebP · one file, up to 4 MB</span>
				</label>
				<input
					id="plan-file"
					class="sr-only"
					type="file"
					accept="application/pdf,text/plain,text/csv,text/markdown,image/jpeg,image/png,image/webp,.pdf,.txt,.csv,.tsv,.md"
					onchange={onPick}
				/>

				{#if lastFile && !file}
					<p class="muted small" style="margin:0">
						The last read used <strong>{lastFile}</strong>. Pick it again to re-run with the
						guidance below — the document itself is not kept.
					</p>
				{/if}

				<div class="field">
					<label for="guidance">Guidance</label>
					<textarea
						id="guidance"
						bind:value={guidance}
						rows="4"
						placeholder="e.g. Spread over 40 weeks. Quizzes are in the right-hand column — keep each one in the week of the chapter it covers. Break weeks at Thanksgiving and for two weeks at Christmas. Skip the optional labs."
					></textarea>
					<span class="hint">
						Anything the file cannot know: how long the term is, where the breaks go, which
						columns matter, what to leave out.
					</span>
				</div>

				{#if importError}
					<div class="alert alert-bad">{importError}</div>
				{/if}

				<button
					class="btn btn-primary btn-block"
					type="button"
					disabled={!file || busy}
					onclick={startImport}
				>
					{#if busy}
						<span class="spinner"></span> Reading…
					{:else if lastFile}
						Read it again
					{:else}
						Read the file
					{/if}
				</button>

				<p class="muted small center" style="margin:0">
					This replaces everything in the boxes below. Nothing is written to the class until you
					press Save plan.
				</p>
			</div>
		</details>

		{#if importNotes}
			<div class="hint-card">
				<h4>How it read the file</h4>
				<p style="margin:0 0 .5rem">{importNotes}</p>
				<button class="btn btn-sm" type="button" onclick={() => (panelOpen = true)}>
					Not quite — edit the guidance and read it again
				</button>
			</div>
		{/if}

		<!--
			The action carries the view along with it. A bare `?/save` replaces the
			whole query string, so the reload that follows a save would land on the
			first class with the default week count — and a plan just imported over
			40 weeks would come back showing 18 of them.
		-->
		<form
			method="POST"
			action="?class={data.classId}&start={data.start}&weeks={weeks.length}&/save"
		>
			<input type="hidden" name="class_id" value={data.classId} />
			<input type="hidden" name="weeks" value={JSON.stringify(payload)} />

			<div class="plan-head">
				<span class="chip" style="--tag: var(--c-{klass?.color ?? 'slate'})">
					<span class="chip-dot"></span>{klass?.name}
				</span>
				<span class="muted small">{totalGoals} goals across {weeks.length} weeks</span>
				<div class="spacer"></div>
				<button class="btn btn-primary btn-sm" type="submit">Save plan</button>
			</div>

			<ul class="plan-list">
				{#each weeks as w (w)}
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
