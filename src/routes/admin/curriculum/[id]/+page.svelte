<script lang="ts">
	import { enhance } from '$app/forms';
	import { beforeNavigate } from '$app/navigation';
	import { untrack } from 'svelte';
	import Markdown from '$lib/components/Markdown.svelte';
	import OutlineGenerator, { type Outcome } from '$lib/components/OutlineGenerator.svelte';
	import { countNotes } from '$lib/markdown';
	import { weekLabel } from '$lib/week';

	let { data, form } = $props();

	type Mode = 'write' | 'split' | 'preview';

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

	const fingerprint = (t: string, c: string, w: string, b: string) =>
		JSON.stringify([t.trim(), c, w, b]);
	const baseline = $derived(
		fingerprint(data.resource.title, data.resource.class_id, data.resource.week_start ?? '', data.resource.body)
	);
	const dirty = $derived(fingerprint(title, classId, week, body) !== baseline);

	// Open to the rendered page when there is something to read — this is also
	// where the teacher lectures from — and straight into writing when there is not.
	// Chosen once per visit; saving should not flip the view out from under you.
	let mode = $state<Mode>(untrack(() => (data.resource.body.trim() ? 'preview' : 'split')));
	let showNotes = $state(true);
	let saving = $state(false);
	let leaving = false;

	const noteCount = $derived(countNotes(body));
	const klass = $derived(data.classes.find((c) => c.id === classId));

	let formEl = $state<HTMLFormElement>();
	let ta = $state<HTMLTextAreaElement>();

	/*
	 * Outline generation streams into the body. It is added below whatever is
	 * already written, the textarea is read-only while it runs, and a failed run
	 * puts the body back exactly as it was.
	 */
	let genOpen = $state(false);
	let generating = $state(false);
	let beforeGen = '';

	function genStart() {
		beforeGen = body;
		body = body.trim() ? body.replace(/\s*$/, '') + '\n\n' : '';
		generating = true;
		if (mode !== 'split') mode = 'split';
	}

	function genEnd(outcome: Outcome) {
		generating = false;
		if (outcome === 'error') body = beforeGen;
		if (outcome === 'done') genOpen = false;
	}

	function save() {
		if (dirty && !saving) formEl?.requestSubmit();
	}

	beforeNavigate((nav) => {
		if (!dirty || leaving) return;
		// Closing the tab or reloading: cancel() makes the browser ask.
		if (nav.type === 'leave') nav.cancel();
		else if (!confirm('You have unsaved changes. Leave without saving?')) nav.cancel();
	});

	/**
	 * Replaces the selection through execCommand so the edit lands on the
	 * textarea's own undo stack — assigning to `body` would make Cmd-Z skip it.
	 * `from`/`to` select a range of the inserted text afterwards.
	 */
	function insert(text: string, from = text.length, to = from) {
		if (!ta) return;
		ta.focus();
		const start = ta.selectionStart;
		if (!document.execCommand('insertText', false, text)) {
			ta.setRangeText(text, start, ta.selectionEnd, 'end');
			ta.dispatchEvent(new Event('input', { bubbles: true }));
		}
		ta.setSelectionRange(start + from, start + to);
	}

	function selection() {
		return ta ? body.slice(ta.selectionStart, ta.selectionEnd) : '';
	}

	/** Wraps the selection inline, e.g. **bold** or $math$. */
	function wrap(before: string, after: string, placeholder: string) {
		const sel = selection() || placeholder;
		insert(before + sel + after, before.length, before.length + sel.length);
	}

	/** Wraps the selection in a fenced block on lines of its own, blank line either side. */
	function fence(open: string, close: string, placeholder: string) {
		if (!ta) return;
		const before = body.slice(0, ta.selectionStart);
		const after = body.slice(ta.selectionEnd);
		const pre = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
		const post = !after || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
		const sel = selection().replace(/^\n+|\n+$/g, '') || placeholder;
		const head = `${pre}${open}\n`;
		insert(`${head}${sel}\n${close}${post}`, head.length, head.length + sel.length);
	}

	/** Puts a prefix at the start of every selected line — headings and lists. */
	function prefixLines(prefix: string) {
		if (!ta) return;
		const lineStart = body.lastIndexOf('\n', ta.selectionStart - 1) + 1;
		ta.setSelectionRange(lineStart, ta.selectionEnd);
		const lines = (selection() || '').split('\n').map((l) => prefix + l);
		const text = lines.join('\n');
		insert(text, prefix.length, text.length);
	}

	/**
	 * Tab / Shift-Tab: moves every selected line one outline level in or out.
	 * Four spaces nests under both `1. ` and `10. ` parents.
	 */
	function indentLines(dir: 1 | -1) {
		if (!ta) return;
		const { selectionStart: start, selectionEnd: end } = ta;
		const lineStart = body.lastIndexOf('\n', start - 1) + 1;
		// A selection ending at the start of a line doesn't include that line.
		const lastEnd = end > start && body[end - 1] === '\n' ? end - 1 : end;
		const nl = body.indexOf('\n', lastEnd);
		const lineEnd = nl === -1 ? body.length : nl;

		const lines = body.slice(lineStart, lineEnd).split('\n');
		const multi = lines.length > 1;
		const out = lines.map((l) =>
			dir === 1 ? (multi && !l.trim() ? l : '    ' + l) : l.replace(/^(\t| {1,4})/, '')
		);
		const text = out.join('\n');
		if (text === lines.join('\n')) return;

		ta.setSelectionRange(lineStart, lineEnd);
		if (start === end) {
			// Keep the caret where it was in the line, never left of the line start.
			const caret = Math.max(0, start - lineStart + out[0].length - lines[0].length);
			insert(text, caret);
		} else {
			insert(text, 0, text.length);
		}
	}

	const note = () => wrap('{{', '}}', 'remind myself to…');
	const blank = () => wrap('[[', ']]', 'answer');
	const outline = () => fence('::: outline', ':::', '- Main point\n    - Sub-point\n        - Detail');
	const mathBlock = () => fence('$$', '$$', 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}');

	/** Esc, then Tab, leaves the editor — otherwise keyboard users are trapped in it. */
	let tabReleased = false;

	function onEditorKeydown(e: KeyboardEvent) {
		if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
			if (tabReleased) {
				tabReleased = false;
				return;
			}
			e.preventDefault();
			indentLines(e.shiftKey ? -1 : 1);
			return;
		}
		if (e.key !== 'Shift') tabReleased = e.key === 'Escape';

		if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
		const k = e.key.toLowerCase();
		if (k === 'b') wrap('**', '**', 'bold');
		else if (k === 'i') wrap('*', '*', 'italic');
		else return;
		e.preventDefault();
	}

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
			<button class="btn btn-sm" type="button" onclick={() => (genOpen = !genOpen)} aria-expanded={genOpen}>
				Outline from textbook…
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
			{classId}
			className={klass?.name ?? ''}
			onstart={genStart}
			ontext={(t) => (body += t)}
			onend={genEnd}
			onclose={() => (genOpen = false)}
		/>
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
				{#each [['write', 'Write'], ['split', 'Split'], ['preview', 'Read']] as [m, label] (m)}
					<button
						type="button"
						aria-pressed={mode === m}
						onclick={() => (mode = m as Mode)}>{label}</button
					>
				{/each}
			</div>

			{#if mode !== 'preview'}
				<div class="cur-format" role="group" aria-label="Formatting">
					<button type="button" class="btn btn-sm" title="Heading" onclick={() => prefixLines('## ')}>H</button>
					<button type="button" class="btn btn-sm" title="Bold (⌘B)" onclick={() => wrap('**', '**', 'bold')}><b>B</b></button>
					<button type="button" class="btn btn-sm" title="Italic (⌘I)" onclick={() => wrap('*', '*', 'italic')}><i>I</i></button>
					<button type="button" class="btn btn-sm" title="Bulleted list" onclick={() => prefixLines('- ')}>• List</button>
					<button type="button" class="btn btn-sm" title="Inline math" onclick={() => wrap('$', '$', 'x^2')}>$x$</button>
					<button type="button" class="btn btn-sm" title="Display math" onclick={mathBlock}>$$</button>
					<button type="button" class="btn btn-sm" title="Outline — I. a. 1. by indent (Tab / Shift-Tab)" onclick={outline}>+ Outline</button>
					<button type="button" class="btn btn-sm" title="Fill-in blank — [[answer]], or [[3: answer]] for 3 lines of writing space" onclick={blank}>+ Blank</button>
					<button type="button" class="btn btn-sm cur-note-btn" title="Teacher note — hidden on handouts" onclick={note}>+ Note</button>
				</div>
			{/if}

			{#if mode !== 'write'}
				<label class="check small cur-notes-toggle">
					<input type="checkbox" bind:checked={showNotes} />
					Teacher notes{noteCount ? ` (${noteCount})` : ''}
				</label>
			{/if}
		</div>

		<div class="cur-editor mode-{mode}">
			<!-- Kept mounted in Read mode (just hidden) so the form still submits the body. -->
			<textarea
				class="cur-source"
				name="body"
				aria-label="Markdown source"
				spellcheck="true"
				placeholder={'# Lecture title\n\nProse, lists and tables in Markdown. Math in $x^2$ or on its own lines:\n\n$$\n\\int_0^1 x\\,dx = \\tfrac12\n$$\n\n::: outline\n- Marked I. a. 1. by indent\n    - Tab to nest, Shift-Tab to outdent {{only I see this — hidden on handouts}}\n:::'}
				bind:this={ta}
				value={body}
				oninput={(e) => (body = e.currentTarget.value)}
				onkeydown={onEditorKeydown}
				readonly={generating}
				hidden={mode === 'preview'}
			></textarea>

			{#if mode !== 'write'}
				<div class="card cur-preview" aria-label="Preview">
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
