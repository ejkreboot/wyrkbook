<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import type { EditorView } from '@codemirror/view';
	import { onDestroy, untrack } from 'svelte';
	import LiveEditor from '$lib/components/LiveEditor.svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import OutlineGenerator, { type Generated } from '$lib/components/OutlineGenerator.svelte';
	import WordImport, { type ImportRequest } from '$lib/components/WordImport.svelte';
	import { fence, prefixLines, wrap } from '$lib/editor/commands';
	import { countNotes } from '$lib/markdown';
	import { levelInfo, OUTLINE_LEVELS, rememberLevel, type OutlineLevel } from '$lib/outlineLevels';
	import { asLines, closingFence, continueOutline, followEdit } from '$lib/outlineRegion';
	import { streamOutline } from '$lib/outlineStream';
	import type { OutlineSource } from '$lib/types';
	import { weekLabel } from '$lib/week';

	let { data, form } = $props();

	type Mode = 'edit' | 'read';

	/*
	 * Writable deriveds: each field follows the server until the teacher edits it,
	 * then holds the edit until the server sends a fresh resource (after a save).
	 * A failed save does not reload data, so the edits survive it. The inputs set
	 * them by hand below rather than with bind:, which Svelte only allows on a
	 * derived by way of a side condition.
	 */
	let title = $derived(data.resource.title);
	let classId = $derived(data.resource.class_id);
	let week = $derived(data.resource.week_start ?? '');
	let body = $derived(data.resource.body);
	let source = $derived(data.resource.outline_source);

	// Field by field, because the database hands jsonb back with its keys reordered.
	const sourcePrint = (o: OutlineSource | null) =>
		o && [o.guided, o.level, o.instructions, o.start, o.end, o.edited];
	const fingerprint = (t: string, c: string, w: string, b: string, o: OutlineSource | null) =>
		JSON.stringify([t.trim(), c, w, b, sourcePrint(o)]);
	const baseline = $derived(
		fingerprint(
			data.resource.title,
			data.resource.class_id,
			data.resource.week_start ?? '',
			data.resource.body,
			data.resource.outline_source
		)
	);
	const dirty = $derived(fingerprint(title, classId, week, body, source) !== baseline);

	// Open to the rendered page when there is something to read — this is also
	// where the teacher lectures from — and straight into writing when there is not.
	// Chosen once per visit; saving should not flip the view out from under you.
	let mode = $state<Mode>(untrack(() => (data.resource.body.trim() ? 'read' : 'edit')));
	let showNotes = $state(true);
	let saving = $state(false);
	let leaving = false;

	const noteCount = $derived(countNotes(body));
	const klass = $derived(data.classes.find((c) => c.id === classId));

	let formEl = $state<HTMLFormElement>();
	let editor = $state<EditorView>();

	/*
	 * Outline generation. The generator reads the pages into a Guided outline;
	 * `source` keeps it (and saves it with the resource), along with where the
	 * outline written from it sits in the body. The level the teacher wants is
	 * written from the Guided outline — no photos needed — whether it is the
	 * first outline, a move to another level, or pages appended later, and it
	 * streams into the body as it comes. The editor is read-only meanwhile.
	 *
	 * A run that fails changes nothing, and can be retried from what is in memory
	 * without photographing the pages again.
	 */
	let genOpen = $state(false);
	// The list page's "Import from Word" lands here with ?import, to open straight into it.
	let importOpen = $state(untrack(() => page.url.searchParams.has('import')));
	$effect(() => {
		if (!page.url.searchParams.has('import')) return;
		const url = new URL(page.url);
		url.searchParams.delete('import');
		try {
			replaceState(url, {});
		} catch {
			// Router not ready yet: the flag just stays in the address bar.
		}
	});
	let generating = $state(false);
	let genStatus = $state('');
	let genProblem = $state('');
	let genRetry = $state<(() => void) | null>(null);
	let genController: AbortController | undefined;
	onDestroy(() => genController?.abort());

	function onBodyInput(next: string) {
		if (source) {
			const { start, end, touched } = followEdit(source, body, next);
			source = { ...source, start, end, edited: source.edited || touched };
		}
		body = next;
	}

	function outlineGenerated(result: Generated) {
		genOpen = false;
		if (result.append && source) appendOutline(source, result);
		else newOutline(result);
	}

	/** Adds a new outline below whatever is already written. */
	async function newOutline(r: Generated) {
		const original = body;
		body = body.trim() ? body.replace(/\s*$/, '') + '\n\n' : '';
		const at = body.length;
		const request =
			r.level === 'guided' ? r.guided : { guided: r.guided, level: r.level, instructions: r.instructions };
		// Stopping partway keeps what was written: there was nothing here to go back to.
		const text = await writeInto(at, 0, `the ${levelInfo(r.level).label} outline`, request, true, (t) => t);
		if (text === null) {
			body = original;
			genRetry = () => newOutline(r);
			return;
		}
		source = { ...r, start: at, end: at + text.length, edited: false };
	}

	/**
	 * Adds a lecture converted from Word below whatever is already written. It is
	 * the teacher's own outline, at whatever level they wrote it, so it is not
	 * tied to `source` and the level switcher leaves it alone.
	 */
	async function importWord(r: ImportRequest) {
		importOpen = false;
		const original = body;
		body = body.trim() ? body.replace(/\s*$/, '') + '\n\n' : '';
		// Built afresh each time, so a retry sends exactly the same.
		const form = new FormData();
		if (r.handout) form.append('handout', JSON.stringify(r.handout));
		if (r.teacher) form.append('teacher', JSON.stringify(r.teacher));
		form.append('instructions', r.instructions);
		form.append('missing', r.missing.join(','));
		for (const p of r.pictures) form.append('picture', p.file, `${p.n}.jpg`);
		const text = await writeInto(body.length, 0, 'the imported outline', form, true, (t) => t, '/api/outline/import');
		if (text === null) {
			body = original;
			genRetry = () => importWord(r);
		}
	}

	/** Rewrites the outline at another level, carrying over the teacher's edits if there are any. */
	async function relevel(level: OutlineLevel) {
		const s = source;
		if (!s || generating) return;
		rememberLevel(classId, level);
		const current = body.slice(s.start, s.end);
		// Guided is already written, unless the teacher's edits need folding into it.
		const request =
			level === 'guided' && !s.edited
				? s.guided
				: { guided: s.guided, current: s.edited ? current : '', level, instructions: s.instructions };
		const text = await writeInto(s.start, s.end - s.start, `the ${levelInfo(level).label} outline`, request, false, (t) => t);
		if (text === null) {
			genRetry = () => relevel(level);
			return;
		}
		source = { ...s, level, end: s.start + text.length, edited: false };
	}

	/** Adds the outline of later pages to the end of the outline, at its level. */
	async function appendOutline(s: OutlineSource, r: Generated) {
		const current = body.slice(s.start, s.end);
		const fence = closingFence(current);
		// Inside the outline block, or after the outline if the teacher took its fence out.
		const at = s.start + (fence === -1 ? current.length : fence);
		const lead = fence === -1 && current && !current.endsWith('\n') ? '\n' : '';
		const request =
			s.level === 'guided'
				? r.guided
				: { guided: s.guided, addition: r.guided, current, level: s.level, instructions: s.instructions };
		const text = await writeInto(at, 0, 'the new pages', request, false, (t) => lead + asLines(t));
		if (text === null) {
			genRetry = () => {
				if (source) appendOutline(source, r);
			};
			return;
		}
		source = {
			...s,
			guided: continueOutline(s.guided, r.guided),
			instructions: [s.instructions, r.instructions].filter(Boolean).join('\n\n').slice(0, 2000),
			end: s.end + text.length
		};
	}

	/**
	 * Puts an outline into the body in place of body[at, at + cut): `request` as
	 * it is when it is text, or what `url` (/api/outline/relevel unless it says
	 * otherwise) writes for it — sent as JSON, or as it is when it is a form — streamed
	 * in and passed through `shape` on the way. Returns what went in, or null when
	 * the run failed or was stopped (unless `keepPartial`) and the body is back as
	 * it was.
	 */
	async function writeInto(
		at: number,
		cut: number,
		what: string,
		request: string | Record<string, unknown> | FormData,
		keepPartial: boolean,
		shape: (text: string) => string,
		url = '/api/outline/relevel'
	): Promise<string | null> {
		const was = body;
		const before = body.slice(0, at);
		const after = body.slice(at + cut);
		genProblem = '';
		genRetry = null;
		mode = 'edit';

		if (typeof request === 'string') {
			const text = shape(request);
			body = before + text + after;
			return text;
		}

		generating = true;
		genStatus = `Writing ${what}…`;
		genController = new AbortController();
		let streamed = '';
		const { outcome, problem } = await streamOutline(
			url,
			request instanceof FormData
				? (request.set('class_name', klass?.name ?? ''), { body: request, signal: genController.signal })
				: {
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ ...request, class_name: klass?.name ?? '' }),
						signal: genController.signal
					},
			{
				text: (t) => {
					streamed += t;
					body = before + shape(streamed) + after;
				}
			}
		);
		generating = false;
		genStatus = '';
		genController = undefined;

		if (outcome === 'done' || (outcome === 'stopped' && keepPartial)) return shape(streamed);
		body = was;
		genProblem = problem;
		return null;
	}

	function save() {
		if (dirty && !saving && !generating) formEl?.requestSubmit();
	}

	beforeNavigate((nav) => {
		if (!dirty || leaving) return;
		// Closing the tab or reloading: cancel() makes the browser ask.
		if (nav.type === 'leave') nav.cancel();
		else if (!confirm('You have unsaved changes. Leave without saving?')) nav.cancel();
	});

	const note = () => editor && wrap(editor, '{{', '}}', 'remind myself to…');
	const blank = () => editor && wrap(editor, '[[', ']]', 'answer');
	const outline = () => editor && fence(editor, '::: outline', ':::', '- Main point\n    - Sub-point\n        - Detail');
	const mathBlock = () => editor && fence(editor, '$$', '$$', 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}');
	const graph = () =>
		editor && fence(editor, '```graph', '```', 'x: -5..5\ny: -5..5\ny = x^2 - 3\n[[point (0, -3) "vertex"]]');

	function onWindowKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			save();
		}
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="wrap wrap-wide stack">
	<div class="row-between">
		<a class="btn btn-ghost btn-sm" href="/admin/curriculum?class={data.resource.class_id}">← Curriculum</a>
		<div class="btn-row">
			<button
				class="btn btn-sm"
				type="button"
				onclick={() => ((genOpen = !genOpen), (importOpen = false))}
				aria-expanded={genOpen}
				disabled={generating}
			>
				Outline from textbook…
			</button>
			<button
				class="btn btn-sm"
				type="button"
				onclick={() => ((importOpen = !importOpen), (genOpen = false))}
				aria-expanded={importOpen}
				disabled={generating}
			>
				Import from Word…
			</button>
			<a class="btn btn-sm" href="/admin/curriculum/{data.resource.id}/print?notes=0">Print handout</a>
			<a class="btn btn-sm" href="/admin/curriculum/{data.resource.id}/print?notes=1">Print with notes</a>
		</div>
	</div>

	{#if form?.message}
		<div class="alert {form.message === 'Saved.' ? 'alert-ok' : 'alert-bad'}" role="status">
			{form.message}
		</div>
	{/if}

	{#if genOpen}
		<OutlineGenerator
			resourceId={data.resource.id}
			{classId}
			className={klass?.name ?? ''}
			existing={source}
			ongenerated={outlineGenerated}
			onclose={() => (genOpen = false)}
		/>
	{/if}

	{#if importOpen && !generating}
		<WordImport onimport={importWord} onclose={() => (importOpen = false)} />
	{/if}

	{#if !genOpen && !importOpen && (source || generating || genProblem)}
		<section class="card level-bar" aria-label="Outline level">
			{#if source}
				<span class="small" style="font-weight:600">Outline level</span>
				<div class="seg" role="group" aria-label="Outline level">
					{#each OUTLINE_LEVELS as l (l.id)}
						<button
							type="button"
							aria-pressed={source.level === l.id}
							title={l.hint}
							onclick={() => relevel(l.id)}
							disabled={generating || (source.level === l.id && source.end > source.start)}>{l.label}</button
						>
					{/each}
				</div>
			{/if}
			{#if generating}
				<span class="muted small" role="status"><span class="spinner"></span> {genStatus}</span>
				<button class="btn btn-sm" type="button" onclick={() => genController?.abort()}>Stop</button>
			{:else if source}
				<span class="muted small">
					Rewrites the generated outline from its Guided version — no rescanning{source.edited
						? ', and your edits carry over'
						: ''}.
				</span>
			{/if}
			{#if genProblem}
				<div class="alert alert-bad level-problem" role="alert">
					{genProblem}
					{#if genRetry}
						<button class="btn btn-sm" type="button" onclick={genRetry}>Try again</button>
					{/if}
				</div>
			{/if}
		</section>
	{/if}

	<form
		method="POST"
		action="?/save"
		class="stack"
		bind:this={formEl}
		use:enhance={() => {
			saving = true;
			return async ({ update }) => {
				// reset: false — the fields are bound to state, and a reset would
				// snap them back to their first-render values.
				await update({ reset: false });
				saving = false;
			};
		}}
	>
		<div class="save-bar is-sticky cur-bar">
			<input
				class="cur-title"
				name="title"
				type="text"
				aria-label="Title"
				value={title}
				oninput={(e) => (title = e.currentTarget.value)}
				required
			/>
			<select
				name="class_id"
				aria-label="Class"
				value={classId}
				onchange={(e) => (classId = e.currentTarget.value)}
				required
			>
				{#each data.classes as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
			<select
				name="week_start"
				aria-label="Week"
				value={week}
				onchange={(e) => (week = e.currentTarget.value)}
			>
				<option value="">No week</option>
				{#each data.weekOptions as w (w)}
					<option value={w}>Week of {weekLabel(w)}</option>
				{/each}
			</select>
			<div class="spacer"></div>
			{#if dirty}
				<span class="unsaved" role="status"><span class="unsaved-dot"></span>Unsaved</span>
			{/if}
			<button class="btn btn-primary btn-sm" type="submit" disabled={!dirty || saving || generating}>
				{saving ? 'Saving…' : 'Save'}
			</button>
		</div>

		<div class="cur-toolbar">
			<div class="seg" role="group" aria-label="View">
				{#each [['edit', 'Edit'], ['read', 'Read']] as [m, label] (m)}
					<button
						type="button"
						aria-pressed={mode === m}
						onclick={() => (mode = m as Mode)}>{label}</button
					>
				{/each}
			</div>

			{#if mode === 'edit'}
				<!-- mousedown kept from the buttons so the editor keeps its focus and selection. -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<div class="cur-format" role="group" aria-label="Formatting" onmousedown={(e) => e.preventDefault()}>
					<button type="button" class="btn btn-sm" title="Heading" onclick={() => editor && prefixLines(editor, '## ')}>H</button>
					<button type="button" class="btn btn-sm" title="Bold (⌘B)" onclick={() => editor && wrap(editor, '**', '**', 'bold')}><b>B</b></button>
					<button type="button" class="btn btn-sm" title="Italic (⌘I)" onclick={() => editor && wrap(editor, '*', '*', 'italic')}><i>I</i></button>
					<button type="button" class="btn btn-sm" title="Bulleted list" onclick={() => editor && prefixLines(editor, '- ')}>• List</button>
					<button type="button" class="btn btn-sm" title="Inline math" onclick={() => editor && wrap(editor, '$', '$', 'x^2')}>$x$</button>
					<button type="button" class="btn btn-sm" title="Display math" onclick={mathBlock}>$$</button>
					<button
						type="button"
						class="btn btn-sm"
						title={'Graph — a coordinate plane (x: -5..5, y = x^2, point (1, 2) "A", asymptote x = 3) or a number line (number line: -5..5). Lines in [[ ]] are answers: on your copy only.'}
						onclick={graph}>+ Graph</button
					>
					<button type="button" class="btn btn-sm" title="Outline — I. a. 1. by indent (Tab / Shift-Tab)" onclick={outline}>+ Outline</button>
					<button type="button" class="btn btn-sm" title="Fill-in blank — [[answer]]. Enter inside it adds lines of writing space; Backspace takes them away" onclick={blank}>+ Blank</button>
					<button type="button" class="btn btn-sm cur-note-btn" title="Teacher note — hidden on handouts" onclick={note}>+ Note</button>
				</div>
			{/if}

			{#if mode === 'read'}
				<label class="check small cur-notes-toggle">
					<input type="checkbox" bind:checked={showNotes} />
					Teacher notes{noteCount ? ` (${noteCount})` : ''}
				</label>
			{/if}
		</div>

		<div class="cur-editor">
			<input type="hidden" name="outline_source" value={source ? JSON.stringify(source) : ''} />
			<input type="hidden" name="body" value={body} />
			<!-- Kept mounted in Read mode (just hidden) so its cursor and undo history survive. -->
			<div class="card cur-edit" hidden={mode !== 'edit'}>
				<LiveEditor
					value={body}
					oninput={onBodyInput}
					readonly={generating}
					label="Lecture"
					placeholder={'# Lecture title\n\nProse, lists and tables. Math in $x^2$ or on its own lines between $$.\n\n::: outline\n- Marked I. a. 1. by indent\n    - Tab to nest, Shift-Tab to outdent {{only I see this — hidden on handouts}}\n:::'}
					bind:view={editor}
				/>
			</div>

			{#if mode === 'read'}
				<div class="card cur-preview" aria-label="Lecture">
					{#if body.trim()}
						<Markdown source={body} notes={showNotes} />
					{:else}
						<p class="muted">Nothing written yet.</p>
					{/if}
				</div>
			{/if}
		</div>
	</form>

	<p class="muted small" style="margin:0">
		{klass?.name ?? 'No class'} · last saved {new Date(data.resource.updated_at).toLocaleString()}
	</p>

	<form
		method="POST"
		action="?/remove"
		onsubmit={(e) => {
			if (!confirm('Delete this resource? This cannot be undone.')) e.preventDefault();
			else leaving = true;
		}}
	>
		<button class="btn btn-danger btn-sm" type="submit">Delete resource</button>
	</form>
</div>
