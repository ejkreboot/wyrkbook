<script lang="ts">
	/**
	 * The curriculum body editor: CodeMirror with the live preview of
	 * $lib/editor/live. `value` is the Markdown; edits come back through
	 * `oninput`, and outside changes to `value` (an outline streaming in, a
	 * fresh load) are patched into the document in place, so the cursor and
	 * undo history survive them. Those outside changes are not themselves undoable.
	 */
	import 'katex/dist/katex.min.css';
	import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
	import { indentUnit } from '@codemirror/language';
	import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
	import { EditorView, keymap, placeholder as placeholderText } from '@codemirror/view';
	import { onMount } from 'svelte';
	import { formattingKeymap } from '$lib/editor/commands';
	import { livePreview } from '$lib/editor/live';

	let {
		value,
		oninput,
		readonly = false,
		placeholder = '',
		label,
		view = $bindable()
	}: {
		value: string;
		oninput: (next: string) => void;
		readonly?: boolean;
		placeholder?: string;
		label: string;
		/** The CodeMirror view, for the toolbar's commands. */
		view?: EditorView;
	} = $props();

	let host: HTMLDivElement;
	const editable = new Compartment();
	const outside = Annotation.define<boolean>();

	onMount(() => {
		const v = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					history(),
					formattingKeymap,
					keymap.of([...defaultKeymap, ...historyKeymap]),
					indentUnit.of('    '),
					EditorState.tabSize.of(4),
					livePreview(),
					placeholderText(placeholder),
					EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': label }),
					editable.of(EditorState.readOnly.of(readonly)),
					EditorView.updateListener.of((u) => {
						if (u.docChanged && !u.transactions.some((t) => t.annotation(outside)))
							oninput(u.state.doc.toString());
					})
				]
			})
		});
		view = v;
		return () => {
			v.destroy();
			view = undefined;
		};
	});

	// Only the stretch that differs is replaced, so a stream into the middle of
	// the body doesn't move a cursor sitting elsewhere.
	$effect(() => {
		const next = value;
		if (!view) return;
		const cur = view.state.doc.toString();
		if (next === cur) return;
		const shorter = Math.min(cur.length, next.length);
		let p = 0;
		while (p < shorter && cur.charCodeAt(p) === next.charCodeAt(p)) p++;
		let s = 0;
		while (s < shorter - p && cur.charCodeAt(cur.length - 1 - s) === next.charCodeAt(next.length - 1 - s)) s++;
		view.dispatch({
			changes: { from: p, to: cur.length - s, insert: next.slice(p, next.length - s) },
			annotations: [outside.of(true), Transaction.addToHistory.of(false)]
		});
	});

	$effect(() => {
		view?.dispatch({ effects: editable.reconfigure(EditorState.readOnly.of(readonly)) });
	});
</script>

<div class="cur-live" class:is-readonly={readonly} bind:this={host}></div>
