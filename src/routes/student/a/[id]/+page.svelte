<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';

	let { data } = $props();

	const a = $derived(data.assignment);

	let mode = $state<'work' | 'hint' | 'submit'>('work');

	// --- hint state -----------------------------------------------------------
	let hintProblemId = $state('');
	let hintQuestion = $state('');
	let hintFile = $state<File | null>(null);
	let hintPreview = $state('');
	let hintResult = $state<{ hint: string; penalty: number } | null>(null);

	// --- submit state ---------------------------------------------------------
	let pageFiles = $state<File[]>([]);
	let pagePreviews = $state<string[]>([]);

	let busy = $state(false);
	let errorMsg = $state('');

	const penaltySoFar = $derived(Number(data.submission.hint_penalty_total ?? 0));

	function pickHint(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const f = input.files?.[0];
		if (!f) return;
		if (hintPreview) URL.revokeObjectURL(hintPreview);
		hintFile = f;
		hintPreview = URL.createObjectURL(f);
		input.value = '';
	}

	function pickPages(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		pageFiles = [...pageFiles, ...Array.from(input.files ?? [])].slice(0, 8);
		pagePreviews = pageFiles.map((f) => URL.createObjectURL(f));
		input.value = '';
	}

	function removePage(i: number) {
		URL.revokeObjectURL(pagePreviews[i]);
		pageFiles = pageFiles.filter((_, n) => n !== i);
		pagePreviews = pageFiles.map((f) => URL.createObjectURL(f));
	}

	function tidyError(text: string, status: number) {
		try {
			return JSON.parse(text).message ?? `Something went wrong (${status}).`;
		} catch {
			return text.slice(0, 200) || `Something went wrong (${status}).`;
		}
	}

	async function askForHint() {
		if (!hintFile) return;
		const penalty = Number(a.hint_penalty ?? 0);
		const ok = confirm(
			penalty > 0
				? `A hint costs ${penalty}% off this assignment. Ask anyway?`
				: 'Ask for a hint?'
		);
		if (!ok) return;

		busy = true;
		errorMsg = '';
		try {
			const body = new FormData();
			body.append('submission_id', data.submission.id);
			body.append('problem_id', hintProblemId);
			body.append('question', hintQuestion);
			body.append('images', hintFile);

			const res = await fetch('/api/hint', { method: 'POST', body });
			if (!res.ok) {
				errorMsg = tidyError(await res.text(), res.status);
				return;
			}
			hintResult = await res.json();
			await invalidateAll();
		} catch {
			errorMsg = 'The request failed. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	async function turnIn() {
		if (!pageFiles.length) return;
		if (!confirm('Turn in your work? You will not be able to change it afterwards.')) return;

		busy = true;
		errorMsg = '';
		try {
			const body = new FormData();
			body.append('submission_id', data.submission.id);
			for (const f of pageFiles) body.append('images', f);

			const res = await fetch('/api/grade', { method: 'POST', body });
			if (!res.ok) {
				errorMsg = tidyError(await res.text(), res.status);
				return;
			}
			await goto(`/student/result/${data.submission.id}`, { invalidateAll: true });
		} catch {
			errorMsg = 'The request failed. Check your connection and try again.';
		} finally {
			busy = false;
		}
	}

	function resetHint() {
		hintResult = null;
		hintFile = null;
		if (hintPreview) URL.revokeObjectURL(hintPreview);
		hintPreview = '';
		hintQuestion = '';
		mode = 'work';
	}
</script>

<div class="wrap wrap-narrow stack">
	<div class="tagged card" style="--tag: var(--c-{data.classColor})">
		<div class="card-title">{a.title}</div>
		<div class="card-note">{data.className}</div>
		{#if penaltySoFar > 0}
			<div class="penalty-note" style="margin-top:.35rem">
				−{penaltySoFar}% so far from {data.hints.length} hint{data.hints.length === 1 ? '' : 's'}
			</div>
		{/if}
	</div>

	{#if errorMsg}
		<div class="alert alert-bad">{errorMsg}</div>
	{/if}

	{#if mode === 'work'}
		{#if a.instructions}
			<div class="card">
				<div class="label">Instructions</div>
				<p style="margin:.25rem 0 0">{a.instructions}</p>
			</div>
		{/if}

		<div class="card">
			<div class="card-head"><span class="card-title">Problems</span></div>
			<ol class="stack-s" style="padding-left:1.2rem;margin:0">
				{#each data.problems as p (p.id)}
					<li value={p.label}>
						<span class="mono" style="color:var(--accent);font-weight:700">{p.label}.</span>
						{p.body}
					</li>
				{/each}
			</ol>
		</div>

		{#if data.hints.length}
			<div class="card stack-s">
				<div class="card-title">Hints you've had</div>
				{#each data.hints as h (h.id)}
					<div class="hint-card">
						<h4>Hint · −{h.penalty}%</h4>
						<div style="white-space:pre-wrap">{h.hint}</div>
					</div>
				{/each}
			</div>
		{/if}

		<div class="btn-row">
			<button class="btn" onclick={() => (mode = 'hint')}>I'm stuck — get a hint</button>
			<button class="btn btn-primary" onclick={() => (mode = 'submit')}>Turn in my work</button>
		</div>
	{/if}

	{#if mode === 'hint'}
		{#if hintResult}
			<div class="hint-card">
				<h4>Hint · −{hintResult.penalty}%</h4>
				<div style="white-space:pre-wrap">{hintResult.hint}</div>
			</div>
			<button class="btn btn-primary btn-block" onclick={resetHint}>Back to my work</button>
		{:else}
			<div class="card stack-s">
				<div>
					<h2 style="margin-bottom:.25rem">Get a hint</h2>
					<p class="muted small" style="margin:0">
						Photograph what you've tried so far. You'll get a nudge, never the answer.
					</p>
					{#if Number(a.hint_penalty) > 0}
						<p class="penalty-note" style="margin:.4rem 0 0">
							This costs {a.hint_penalty}% off your score.
						</p>
					{/if}
				</div>

				<div class="field">
					<label for="hp">Which problem?</label>
					<select id="hp" bind:value={hintProblemId}>
						<option value="">I'm not sure</option>
						{#each data.problems as p (p.id)}
							<option value={p.id}>{p.label}</option>
						{/each}
					</select>
				</div>

				<div class="field">
					<label for="hq">What's confusing? (optional)</label>
					<textarea id="hq" bind:value={hintQuestion} placeholder="I don't know what to do after step 2"></textarea>
				</div>

				{#if hintPreview}
					<div class="thumb-grid">
						<div class="thumb"><img src={hintPreview} alt="Your work" /></div>
					</div>
				{/if}

				<label class="btn btn-capture" for="hshot">
					<span class="big">📷</span>
					<span>{hintPreview ? 'Retake the photo' : 'Photograph your work'}</span>
				</label>
				<input
					id="hshot"
					class="sr-only"
					type="file"
					accept="image/jpeg,image/png,image/webp"
					capture="environment"
					onchange={pickHint}
				/>

				<div class="btn-row">
					<button class="btn btn-primary" disabled={!hintFile || busy} onclick={askForHint}>
						{#if busy}<span class="spinner"></span> Thinking…{:else}Ask for a hint{/if}
					</button>
					<button class="btn btn-ghost" onclick={() => (mode = 'work')}>Never mind</button>
				</div>
			</div>
		{/if}
	{/if}

	{#if mode === 'submit'}
		<div class="card stack-s">
			<div>
				<h2 style="margin-bottom:.25rem">Turn in your work</h2>
				<p class="muted small" style="margin:0">
					Photograph every page you wrote on, in order. Make sure the problem numbers in the left
					margin are readable.
				</p>
			</div>

			{#if pagePreviews.length}
				<div class="thumb-grid">
					{#each pagePreviews as src, i (src)}
						<div class="thumb">
							<img {src} alt="Page {i + 1}" />
							<button class="thumb-x" type="button" onclick={() => removePage(i)} aria-label="Remove page {i + 1}">×</button>
						</div>
					{/each}
				</div>
			{/if}

			<label class="btn btn-capture" for="pshot">
				<span class="big">📷</span>
				<span>{pagePreviews.length ? 'Add another page' : 'Photograph your pages'}</span>
				<span class="hint">up to 8 pages</span>
			</label>
			<input
				id="pshot"
				class="sr-only"
				type="file"
				accept="image/jpeg,image/png,image/webp"
				capture="environment"
				multiple
				onchange={pickPages}
			/>

			<div class="btn-row">
				<button class="btn btn-primary" disabled={!pageFiles.length || busy} onclick={turnIn}>
					{#if busy}<span class="spinner"></span> Grading…{:else}Turn in{/if}
				</button>
				<button class="btn btn-ghost" onclick={() => (mode = 'work')} disabled={busy}>Back</button>
			</div>

			{#if busy}
				<p class="muted small center">Reading your handwriting — this takes a moment.</p>
			{/if}
		</div>
	{/if}
</div>
