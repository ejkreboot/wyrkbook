<script lang="ts">
	import { weekLabel } from '$lib/week';
	import ProblemText from '$lib/components/ProblemText.svelte';
	import {
		DEFAULT_TRIM_LEVEL,
		rememberedTrimLevel,
		rememberTrimLevel,
		TRIM_LEVELS,
		trimLevelInfo,
		type TrimLevel
	} from '$lib/trimLevels';
	import { DEFAULT_WORK_LINES, MAX_WORK_LINES } from '$lib/workSpace';

	let { data, form } = $props();

	/**
	 * What the last trim said about a row. `was` is the row's checkbox before the
	 * first trim, so Undo goes back to the teacher's own selection however many
	 * times they have asked for another.
	 */
	type Trim = { review: boolean; note: string; was: boolean };

	type Row = {
		id: string | null;
		label: string;
		section: string;
		directions: string;
		body: string;
		work_lines: number | null;
		answer: string;
		points: number;
		included: boolean;
		trim: Trim | null;
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
				section: p.section ?? '',
				directions: p.directions ?? '',
				body: p.body,
				work_lines: p.work_lines,
				answer: p.answer ?? '',
				points: Number(p.points ?? 1),
				included: p.included,
				trim: null
			}));
		}
	});

	const a = $derived(data.assignment);
	const kept = $derived(rows.filter((r) => r.included).length);
	const klass = $derived(data.classes.find((c) => c.id === a.class_id));

	let showAnswers = $state(false);

	function addRow() {
		rows = [
			...rows,
			{
				id: null,
				label: String(rows.length + 1),
				section: rows.at(-1)?.section ?? '',
				directions: rows.at(-1)?.directions ?? '',
				body: '',
				work_lines: null,
				answer: '',
				points: 1,
				included: true,
				trim: null
			}
		];
	}

	// --- trimming ---------------------------------------------------------------

	let trimLevel = $state<TrimLevel>(DEFAULT_TRIM_LEVEL);
	$effect(() => {
		trimLevel = rememberedTrimLevel(a.class_id);
	});
	function pickTrimLevel(l: TrimLevel) {
		trimLevel = l;
		rememberTrimLevel(a.class_id, l);
	}

	let trimGuidance = $state('');
	let trimming = $state(false);
	let trimError = $state('');
	let trimSummary = $state('');

	/*
	 * Selections already shown, so "another selection" can steer away from them.
	 * Keys are positions in the list, so a selection only counts while the list
	 * is the one it was made from: `stamp` is that list's labels and text.
	 */
	let shown = $state<{ level: TrimLevel; stamp: string; kept: string[] }[]>([]);
	const stamp = $derived(rows.map((r) => `${r.label}\u0000${r.body}`).join('\u0001'));
	const previous = $derived(
		shown.filter((h) => h.level === trimLevel && h.stamp === stamp).map((h) => h.kept)
	);
	const trimmed = $derived(rows.some((r) => r.trim));
	const reviewCount = $derived(rows.filter((r) => r.trim?.review).length);
	const reviewKept = $derived(rows.filter((r) => r.trim?.review && r.included).length);

	async function trim() {
		const sent = stamp;
		trimming = true;
		trimError = '';
		try {
			const res = await fetch('/api/trim', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					assignment_id: a.id,
					level: trimLevel,
					guidance: trimGuidance,
					previous,
					problems: rows.map((r) => ({ label: r.label, section: r.section, body: r.body }))
				})
			});
			if (!res.ok) {
				trimError = tidyError(await res.text(), res.status);
				return;
			}
			const result: {
				problems: { key: string; review: boolean; keep: boolean; note: string }[];
				summary: string;
			} = await res.json();
			if (stamp !== sent) {
				trimError = 'The list changed while it was being trimmed. Try again.';
				return;
			}

			shown = [
				...shown,
				{
					level: trimLevel,
					stamp: sent,
					kept: result.problems.filter((v) => v.keep).map((v) => v.key)
				}
			];
			rows = rows.map((r, i) => {
				const v = result.problems[i];
				return {
					...r,
					included: v.keep,
					trim: { review: v.review, note: v.note, was: r.trim?.was ?? r.included }
				};
			});
			trimSummary = result.summary;
		} catch {
			trimError = 'The request failed. Check your connection and try again.';
		} finally {
			trimming = false;
		}
	}

	// --- work space ---------------------------------------------------------------

	let sizing = $state(false);
	let sizeError = $state('');
	let sized = $state(false);
	const unsized = $derived(rows.filter((r) => r.included && r.work_lines == null).length);

	/** Asks the AI how much room each problem needs; fills in the lines, unsaved. */
	async function sizeWorkSpace() {
		const sent = stamp;
		sizing = true;
		sizeError = '';
		try {
			const res = await fetch('/api/work-space', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					assignment_id: a.id,
					problems: rows.map((r) => ({ label: r.label, directions: r.directions, body: r.body }))
				})
			});
			if (!res.ok) {
				sizeError = tidyError(await res.text(), res.status);
				return;
			}
			const result: { lines: number[] } = await res.json();
			if (stamp !== sent) {
				sizeError = 'The list changed while it was being sized. Try again.';
				return;
			}
			rows = rows.map((r, i) => ({ ...r, work_lines: result.lines[i] ?? r.work_lines }));
			sized = true;
		} catch {
			sizeError = 'The request failed. Check your connection and try again.';
		} finally {
			sizing = false;
		}
	}

	function undoTrim() {
		rows = rows.map((r) => (r.trim ? { ...r, included: r.trim.was, trim: null } : r));
		trimSummary = '';
	}

	/** SvelteKit `error()` responses are JSON; fall back to the raw text. */
	function tidyError(text: string, status: number) {
		try {
			return JSON.parse(text).message ?? `Request failed (${status}).`;
		} catch {
			return text.slice(0, 200) || `Request failed (${status}).`;
		}
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
		<input type="hidden" name="problems" value={JSON.stringify(rows.map(({ trim, ...r }) => r))} />

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
					<label for="pages">Extra ruled pages</label>
					<input id="pages" name="work_pages" type="number" min="0" max="20" value={a.work_pages} />
					<span class="hint">For overflow: each problem prints with its own work space.</span>
				</div>
			</div>
		</div>

		<div class="card stack-s">
			<div class="card-head">
				<span class="card-title">Trim the repetition</span>
				<span class="card-note">Review problems are kept.</span>
			</div>
			<p class="hint" style="margin:0">
				Picks the problems worth doing and unchecks the rest. Nothing is saved until you save, and
				you can ask for another selection as often as you like.
			</p>

			<div class="stack" style="gap:.4rem">
				<div class="row" style="gap:.6rem;flex-wrap:wrap;align-items:center">
					<span class="small" style="font-weight:600">How hard</span>
					<div class="seg" role="group" aria-label="How hard to trim">
						{#each TRIM_LEVELS as l (l.id)}
							<button
								type="button"
								aria-pressed={trimLevel === l.id}
								onclick={() => pickTrimLevel(l.id)}
								disabled={trimming}>{l.label}</button
							>
						{/each}
					</div>
				</div>
				<span class="muted small">
					{trimLevelInfo(trimLevel).hint} Keeps {trimLevelInfo(trimLevel).keep} of the lesson's own problems.
				</span>
			</div>

			<label class="stack" style="gap:.3rem">
				<span class="small" style="font-weight:600">Anything to add <span class="muted">(optional)</span></span>
				<textarea
					rows="2"
					bind:value={trimGuidance}
					maxlength="1000"
					disabled={trimming}
					placeholder="e.g. Keep every word problem. She has two-step equations down cold."
				></textarea>
			</label>

			{#if trimError}
				<div class="alert alert-bad" role="alert">{trimError}</div>
			{/if}

			{#if trimmed && !trimming}
				<div class="alert alert-ok">
					<div>
						<strong>{kept} of {rows.length} kept</strong>{#if reviewCount}
							· {reviewKept} of {reviewCount} review{/if}. Not saved yet — <em>Save changes</em> to keep
						this selection.
					</div>
					{#if trimSummary}<div class="small" style="margin-top:.3rem">{trimSummary}</div>{/if}
				</div>
			{/if}

			<div class="btn-row">
				<button class="btn btn-primary" type="button" onclick={trim} disabled={trimming || rows.length < 2}>
					{#if trimming}
						<span class="spinner"></span> Reading the set…
					{:else if previous.length}
						Try another selection
					{:else}
						Trim at {trimLevelInfo(trimLevel).label}
					{/if}
				</button>
				{#if trimmed}
					<button class="btn btn-ghost" type="button" onclick={undoTrim} disabled={trimming}>
						Undo trim
					</button>
				{/if}
			</div>
			{#if trimming}
				<p class="muted small" style="margin:0">
					Working out which problems drill the same thing — this takes a little while for a long set.
				</p>
			{/if}
		</div>

		<div class="card">
			<div class="card-head">
				<span class="card-title">Problems</span>
				<span class="card-note">{kept} of {rows.length} assigned</span>
			</div>
			<p class="hint" style="margin-bottom:.75rem">
				Uncheck anything extraneous — unchecked problems are never printed, never shown to
				students, and never graded. <strong>Lines</strong> is the room printed below each problem to
				work it.
			</p>

			<div class="row" style="gap:.6rem;flex-wrap:wrap;align-items:center;margin-bottom:.75rem">
				<button class="btn btn-sm" type="button" onclick={sizeWorkSpace} disabled={sizing || !rows.length}>
					{#if sizing}
						<span class="spinner"></span> Working out the room each needs…
					{:else}
						Size work space with AI
					{/if}
				</button>
				{#if sized && !sizing}
					<span class="small">Sized — not saved yet. <em>Save changes</em> to keep it.</span>
				{:else if unsized && !sizing}
					<span class="muted small">
						{unsized} problem{unsized === 1 ? '' : 's'} not sized yet; {unsized === 1 ? 'it prints' : 'they print'} with {DEFAULT_WORK_LINES} lines.
					</span>
				{/if}
			</div>
			{#if sizeError}
				<div class="alert alert-bad" role="alert" style="margin-bottom:.75rem">{sizeError}</div>
			{/if}

			<ul class="problem-list">
				{#each rows as r, i (i)}
					{#if r.section && r.section !== rows[i - 1]?.section}
						<li class="problem-section">{r.section}</li>
					{/if}
					{#if r.directions && (r.directions !== rows[i - 1]?.directions || r.section !== rows[i - 1]?.section)}
						<li class="problem-directions"><ProblemText body={r.directions} /></li>
					{/if}
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
							<input
								class="problem-lines"
								type="number"
								min="0"
								max={MAX_WORK_LINES}
								bind:value={r.work_lines}
								placeholder={String(DEFAULT_WORK_LINES)}
								aria-label="Lines of work space for problem {r.label}"
								title="Lines of work space printed below the problem"
							/>
							<span class="problem-lines-unit">lines</span>
							{#if r.trim?.review}<span class="badge badge-accent" title="Reviews earlier material">review</span>{/if}
						</div>

						<div class="problem-body">
							<textarea bind:value={r.body} aria-label="Problem {r.label} text"></textarea>
							{#if r.body.includes('$')}
								<ProblemText body={r.body} class="ptext-preview" />
							{/if}
							{#if r.trim?.note}
								<div class="trim-note">{r.trim.note}</div>
							{/if}
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
									<div class="field">
										<label for="sec-{i}">Section</label>
										<input id="sec-{i}" bind:value={r.section} placeholder="e.g. Mixed Review" />
									</div>
								</div>
								<div class="field" style="margin-top:.4rem">
									<label for="dir-{i}">Directions</label>
									<input id="dir-{i}" bind:value={r.directions} placeholder="e.g. Solve for $x$." />
									<span class="hint">Printed once above a run of problems with the same directions.</span>
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
					{showAnswers ? 'Hide' : 'Show'} answers, points, sections &amp; directions
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
