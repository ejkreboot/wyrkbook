<script lang="ts" module>
	export type EditorApi = {
		/** How the editor writes `markdown` back out, without changing what is on screen. */
		normalize(markdown: string): string;
	};
</script>

<script lang="ts">
	/**
	 * The curriculum body editor: Milkdown's Crepe with the curriculum's Markdown
	 * ($lib/editor/milkdown). `value` is the Markdown; edits come back through
	 * `oninput`, written the editor's way. A `value` from outside — a fresh load,
	 * an outline streaming in — replaces the document, and is not itself undoable.
	 *
	 * The editor writes Markdown its own way (`-` bullets, blank lines between
	 * blocks, …), which renders the same but is not the same text. `onready` hands
	 * the page `normalize`, so it can bring a body into that form at a moment of
	 * its choosing rather than have the first keystroke do it.
	 */
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/frame.css';
	import type { Crepe } from '@milkdown/crepe';
	import { onMount } from 'svelte';
	import { createEditor, normalizer, replaceDoc, setReadonly } from '$lib/editor/milkdown';

	let {
		value,
		oninput,
		readonly = false,
		placeholder = '',
		label,
		onready
	}: {
		value: string;
		oninput: (next: string) => void;
		readonly?: boolean;
		placeholder?: string;
		label: string;
		onready?: (api: EditorApi) => void;
	} = $props();

	let host: HTMLDivElement;
	let crepe = $state<Crepe>();
	// The Markdown the document on screen stands for: the last value put in or edit sent out.
	let shown = '';
	// Set while a value from outside goes in, so it isn't sent back as an edit.
	let applying = false;

	onMount(() => {
		let gone = false;
		shown = value;
		const made = createEditor(host, value, placeholder, (markdown) => {
			if (applying || markdown === shown) return;
			shown = markdown;
			oninput(markdown);
		});
		made.then((c) => {
			if (gone) return;
			setReadonly(c, readonly);
			crepe = c;
			c.editor.action((ctx) => {
				const normalize = normalizer(ctx);
				onready?.({ normalize });
			});
		});
		return () => {
			gone = true;
			made.then((c) => c.destroy());
			crepe = undefined;
		};
	});

	$effect(() => {
		const next = value;
		if (!crepe || next === shown) return;
		shown = next;
		// Already showing it, just written differently: nothing to redraw.
		if (next === crepe.getMarkdown()) return;
		applying = true;
		try {
			replaceDoc(crepe, next);
		} finally {
			applying = false;
		}
	});

	$effect(() => {
		if (crepe) setReadonly(crepe, readonly);
	});
</script>

<div class="cur-milkdown" class:is-readonly={readonly} role="group" aria-label={label} bind:this={host}></div>
