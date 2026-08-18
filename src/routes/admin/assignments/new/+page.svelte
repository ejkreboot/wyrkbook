<script lang="ts">
	import { weekLabel, addWeeks } from '$lib/week';

	let { data, form } = $props();

	type Draft = { label: string; body: string };

	let files = $state<File[]>([]);
	let previews = $state<string[]>([]);
	let busy = $state(false);
	let apiError = $state('');

	// Populated once extraction returns; from then on the page is an editor.
	let extracted = $state(false);
	let title = $state('');
	let instructions = $state('');
	let problems = $state<Draft[]>([]);

	// Seeded once from the query string, which does not change while this page lives.
	const seed = data;
	let classId = $state(seed.presetClass || '');
	let week = $state(seed.presetWeek);
	let hintPenalty = $state(5);
	let workPages = $state(4);

	const weekOptions = $derived(
		Array.from({ length: 9 }, (_, i) => addWeeks(data.presetWeek, i - 2))
	);

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const picked = Array.from(input.files ?? []);
		files = [...files, ...picked].slice(0, 8);
		previews = files.map((f) => URL.createObjectURL(f));
		input.value = '';
	}

	function removeAt(i: number) {
		URL.revokeObjectURL(previews[i]);
		files = files.filter((_, n) => n !== i);
		previews = files.map((f) => URL.createObjectURL(f));
	}

	async function extract() {
		if (!files.length) return;
		busy = true;
		apiError = '';
		try {
			const body = new FormData();
			for (const f of files) body.append('images', f);

			const res = await fetch('/api/extract', { method: 'POST', body });
			if (!res.ok) {
				const text = await res.text();
				apiError = tidyError(text, res.status);
				return;
			}
			const result = await res.json();
			title = result.title ?? '';
			instructions = result.instructions ?? '';
			problems = result.problems ?? [];
			extracted = true;
		} catch {
			apiError = 'The request failed. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	/** SvelteKit `error()` responses are JSON; fall back to the raw text. */
	function tidyError(text: string, status: number) {
		try {
			return JSON.parse(text).message ?? `Request failed (${status}).`;
		} catch {
			return text.slice(0, 200) || `Request failed (${status}).`;
		}
	}

	function removeProblem(i: number) {
		problems = problems.filter((_, n) => n !== i);
	}

	function addProblem() {
		problems = [...problems, { label: String(problems.length + 1), body: '' }];
	}
</script>

<div class="wrap wrap-narrow stack">
	<div class="row-between">
		<h1>New assignment</h1>
		<a class="btn btn-ghost btn-sm" href="/admin/assignments">Cancel</a>
	</div>

	{#if form?.message}
		<div class="alert alert-bad">{form.message}</div>
	{/if}
	{#if apiError}
		<div class="alert alert-bad">{apiError}</div>
	{/if}

	{#if !extracted}
		<div class="card stack">
			<div>
				<h2 style="margin-bottom:.25rem">Photograph the exercises</h2>
				<p class="muted small">
					Shoot the page straight on, in good light. Several pages are fine — take them in order.
				</p>
			</div>

			{#if previews.length}
				<div class="thumb-grid">
					{#each previews as src, i (src)}
						<div class="thumb">
							<img {src} alt="Page {i + 1}" />
							<button class="thumb-x" type="button" onclick={() => removeAt(i)} aria-label="Remove page {i + 1}">×</button>
						</div>
					{/each}
				</div>
			{/if}

			<label class="btn btn-capture" for="shot">
				<span class="big">📷</span>
				<span>{previews.length ? 'Add another page' : 'Take or choose photos'}</span>
				<span class="hint">JPEG, PNG or WebP · up to 8 pages</span>
			</label>
			<input
				id="shot"
				class="sr-only"
				type="file"
				accept="image/jpeg,image/png,image/webp"
				capture="environment"
				multiple
				onchange={onPick}
			/>

			<button
				class="btn btn-primary btn-block"
				type="button"
				disabled={!files.length || busy}
				onclick={extract}
			>
				{#if busy}
					<span class="spinner"></span> Reading the page…
				{:else}
					Read {files.length || ''} page{files.length === 1 ? '' : 's'}
				{/if}
			</button>

			{#if busy}
				<p class="muted small center">
					This takes a few seconds. Transcribing carefully beats transcribing fast.
				</p>
			{/if}
		</div>
	{:else}
		<form method="POST" action="?/create" class="stack">
			<input type="hidden" name="problems" value={JSON.stringify(problems)} />

			<div class="card stack-s">
				<div class="field">
					<label for="title">Title</label>
					<input id="title" name="title" type="text" bind:value={title} required />
				</div>

				<div class="field">
					<label for="cls">Class</label>
					<select id="cls" name="class_id" bind:value={classId} required>
						<option value="">Choose…</option>
						{#each data.classes as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
				</div>

				<div class="field">
					<label for="wk">Week</label>
					<select id="wk" name="week_start" bind:value={week}>
						<option value="">Not scheduled</option>
						{#each weekOptions as w (w)}
							<option value={w}>{weekLabel(w)}</option>
						{/each}
					</select>
				</div>

				<div class="field">
					<label for="instructions">Instructions</label>
					<textarea id="instructions" name="instructions" bind:value={instructions}></textarea>
					<span class="hint">Printed at the top of the sheet, above the problems.</span>
				</div>

				<div class="inline-form">
					<div class="field">
						<label for="pen">Hint penalty</label>
						<input id="pen" name="hint_penalty" type="number" min="0" max="100" step="1" bind:value={hintPenalty} />
						<span class="hint">Percentage points off per hint.</span>
					</div>
					<div class="field">
						<label for="pages">Blank work pages</label>
						<input id="pages" name="work_pages" type="number" min="0" max="20" step="1" bind:value={workPages} />
						<span class="hint">Ruled pages printed after the problems.</span>
					</div>
				</div>
			</div>

			<div class="card">
				<div class="card-head">
					<span class="card-title">{problems.length} problems</span>
					<span class="card-note">Delete anything you don't want to assign.</span>
				</div>

				<ul class="problem-list">
					{#each problems as p, i (i)}
						<li class="problem">
							<input
								class="problem-label"
								style="width:3.2rem;min-height:32px;padding:.2rem .3rem"
								bind:value={p.label}
								aria-label="Problem number"
							/>
							<div class="problem-body">
								<textarea bind:value={p.body} aria-label="Problem {p.label}"></textarea>
							</div>
							<div class="problem-actions">
								<button
									class="btn btn-ghost btn-sm"
									type="button"
									onclick={() => removeProblem(i)}
									aria-label="Delete problem {p.label}">×</button
								>
							</div>
						</li>
					{/each}
				</ul>

				<button class="btn btn-sm" style="margin-top:.6rem" type="button" onclick={addProblem}>
					+ Add a problem
				</button>
			</div>

			<div class="btn-row">
				<button class="btn btn-primary" type="submit" disabled={!problems.length}>
					Save assignment
				</button>
				<button class="btn btn-ghost" type="button" onclick={() => (extracted = false)}>
					Back to photos
				</button>
			</div>
		</form>
	{/if}
</div>
