<script lang="ts">
	import { onDestroy } from 'svelte';
	import PhoneCapture from '$lib/components/PhoneCapture.svelte';
	import { shrinkImage, UPLOAD_BUDGET } from '$lib/shrinkImage';
	import {
		DEFAULT_OUTLINE_LEVEL,
		isOutlineLevel,
		OUTLINE_LEVELS,
		type OutlineLevel
	} from '$lib/outlineLevels';

	export type Outcome = 'done' | 'stopped' | 'error';

	let {
		resourceId,
		classId,
		className,
		onstart,
		ontext,
		onend,
		onclose
	}: {
		resourceId: string;
		classId: string;
		className: string;
		/** The first byte of the outline is about to arrive. */
		onstart: () => void;
		ontext: (text: string) => void;
		/** 'error' means what streamed in should be thrown away; 'stopped' keeps it. */
		onend: (outcome: Outcome) => void;
		onclose: () => void;
	} = $props();

	const MAX_PAGES = 10;

	type Page = { file: File; preview: string };
	let pages = $state<Page[]>([]);
	let level = $state<OutlineLevel>(DEFAULT_OUTLINE_LEVEL);
	let instructions = $state('');
	let busy = $state(false);
	let status = $state('');
	let problem = $state('');
	let controller = $state.raw<AbortController>();
	let dragging = $state(false);

	// Sparseness is remembered per class: it moves with the term, one class at a time.
	const levelKey = $derived(`wyrkbook:outline-level:${classId}`);
	$effect(() => {
		try {
			const saved = localStorage.getItem(levelKey);
			level = isOutlineLevel(saved) ? saved : DEFAULT_OUTLINE_LEVEL;
		} catch {
			level = DEFAULT_OUTLINE_LEVEL;
		}
	});
	function pickLevel(l: OutlineLevel) {
		level = l;
		try {
			localStorage.setItem(levelKey, l);
		} catch {
			// Private window or blocked storage: it just won't be remembered.
		}
	}

	const levelHint = $derived(OUTLINE_LEVELS.find((l) => l.id === level)?.hint ?? '');

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const picked = Array.from(input.files ?? []);
		input.value = '';
		addFiles(picked);
	}

	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (busy) return;
		addFiles(Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/')));
	}

	async function addFiles(picked: File[]) {
		problem = '';
		const room = MAX_PAGES - pages.length;
		if (picked.length > room) problem = `Up to ${MAX_PAGES} pages at a time — the rest were left out.`;

		for (const file of picked.slice(0, Math.max(0, room))) await addPage(file);
	}

	async function addPage(file: File) {
		try {
			// A small copy for the thumbnail, which also proves the browser can read it.
			const thumb = await shrinkImage(file, { maxEdge: 360, quality: 0.7 });
			if (pages.length >= MAX_PAGES) return;
			pages = [...pages, { file, preview: URL.createObjectURL(thumb) }];
		} catch (err) {
			problem = (err as Error).message;
		}
	}

	function removeAt(i: number) {
		URL.revokeObjectURL(pages[i].preview);
		pages = pages.filter((_, n) => n !== i);
	}

	function moveEarlier(i: number) {
		const next = [...pages];
		[next[i - 1], next[i]] = [next[i], next[i - 1]];
		pages = next;
	}

	function clearPages() {
		for (const p of pages) URL.revokeObjectURL(p.preview);
		pages = [];
	}
	onDestroy(clearPages);

	async function generate() {
		if (!pages.length || busy) return;
		busy = true;
		problem = '';
		status = 'Preparing photos…';

		let prepared: File[];
		try {
			const perPage = Math.floor(UPLOAD_BUDGET / pages.length);
			prepared = await Promise.all(pages.map((p) => shrinkImage(p.file, { maxBytes: perPage })));
		} catch (err) {
			problem = (err as Error).message;
			busy = false;
			status = '';
			return;
		}

		const form = new FormData();
		for (const f of prepared) form.append('images', f);
		form.append('level', level);
		form.append('class_name', className);
		form.append('instructions', instructions);

		controller = new AbortController();
		let outcome: Outcome = 'error';
		let started = false;
		status = 'Sending pages…';

		try {
			const res = await fetch('/api/outline', { method: 'POST', body: form, signal: controller.signal });
			if (!res.ok || !res.body) {
				problem = tidyError(await res.text(), res.status);
				return;
			}
			onstart();
			started = true;
			status = 'Reading the pages…';

			const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffered = '';
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				buffered += value;
				let nl: number;
				while ((nl = buffered.indexOf('\n')) !== -1) {
					const line = buffered.slice(0, nl).trim();
					buffered = buffered.slice(nl + 1);
					if (!line) continue;
					const event = JSON.parse(line) as { text?: string; status?: string; done?: boolean; error?: string };
					if (event.text) {
						status = 'Writing the outline…';
						ontext(event.text);
					} else if (event.error) {
						problem = event.error;
					} else if (event.done) {
						outcome = 'done';
					}
				}
			}
			if (outcome !== 'done' && !problem) problem = 'The connection closed before the outline was finished.';
		} catch {
			if (controller?.signal.aborted) outcome = 'stopped';
			else problem = 'The request failed. Check your connection and try again.';
		} finally {
			busy = false;
			status = '';
			controller = undefined;
			if (started) onend(outcome);
			if (outcome === 'done') clearPages();
		}
	}

	function stop() {
		controller?.abort();
	}

	/** SvelteKit `error()` responses are JSON; fall back to the raw text. */
	function tidyError(text: string, code: number) {
		try {
			return JSON.parse(text).message ?? `Request failed (${code}).`;
		} catch {
			return code === 413
				? 'Those photos are too large to send together. Try fewer pages.'
				: text.slice(0, 200) || `Request failed (${code}).`;
		}
	}
</script>

<section class="card stack gen-panel" aria-label="Outline from textbook pages">
	<div class="row-between">
		<h2 style="margin:0">Outline from textbook pages</h2>
		<button class="btn btn-ghost btn-sm" type="button" onclick={onclose} disabled={busy}>Close</button>
	</div>
	<p class="muted small" style="margin:0">
		Photograph each page straight on, in good light, in order. The photos go to the AI and are
		discarded. Photos sent from a phone pass through private storage only until they arrive here.
		The outline is added below anything already written.
	</p>

	{#if pages.length}
		<div class="thumb-grid">
			{#each pages as p, i (p.preview)}
				<div class="thumb">
					<img src={p.preview} alt="Page {i + 1}" />
					<span class="thumb-n">{i + 1}</span>
					{#if i > 0}
						<button class="thumb-move" type="button" onclick={() => moveEarlier(i)} disabled={busy} aria-label="Move page {i + 1} earlier">‹</button>
					{/if}
					<button class="thumb-x" type="button" onclick={() => removeAt(i)} disabled={busy} aria-label="Remove page {i + 1}">×</button>
				</div>
			{/each}
		</div>
	{/if}

	{#if pages.length < MAX_PAGES}
		<div class="gen-sources">
			<label
				class="btn btn-capture"
				class:dragging
				for="gen-shot"
				aria-disabled={busy}
				ondragover={(e) => {
					e.preventDefault();
					dragging = true;
				}}
				ondragleave={() => (dragging = false)}
				ondrop={onDrop}
			>
				<span class="big">📷</span>
				<span>{pages.length ? 'Add more pages' : 'Drop photos of the pages here'}</span>
				<span class="hint">or click to choose · up to {MAX_PAGES} pages</span>
			</label>
			<!-- Unmounting it (while generating) clears anything the phone is still sending. -->
			{#if !busy}
				<PhoneCapture {resourceId} remaining={MAX_PAGES - pages.length} oncapture={addPage} />
			{/if}
		</div>
		<input id="gen-shot" class="sr-only" type="file" accept="image/*" capture="environment" multiple onchange={onPick} disabled={busy} />
	{/if}

	<div class="stack" style="gap:.4rem">
		<div class="row" style="gap:.6rem;flex-wrap:wrap;align-items:center">
			<span class="small" style="font-weight:600">Sparseness</span>
			<div class="seg" role="group" aria-label="Sparseness">
				{#each OUTLINE_LEVELS as l (l.id)}
					<button type="button" aria-pressed={level === l.id} onclick={() => pickLevel(l.id)} disabled={busy}>{l.label}</button>
				{/each}
			</div>
		</div>
		<span class="muted small">{levelHint}</span>
	</div>

	<label class="stack" style="gap:.3rem">
		<span class="small" style="font-weight:600">Anything to add <span class="muted">(optional)</span></span>
		<textarea
			rows="2"
			bind:value={instructions}
			maxlength="2000"
			disabled={busy}
			placeholder="e.g. Skip section 3.4. Stop at the end of page 214."
		></textarea>
	</label>

	{#if problem}
		<div class="alert alert-bad" role="alert">{problem}</div>
	{/if}

	<div class="row" style="gap:.6rem;align-items:center">
		{#if busy}
			<button class="btn" type="button" onclick={stop} disabled={!controller}>Stop</button>
			<span class="muted small" role="status"><span class="spinner"></span> {status}</span>
		{:else}
			<button class="btn btn-primary" type="button" onclick={generate} disabled={!pages.length}>
				Generate outline{pages.length ? ` from ${pages.length} page${pages.length === 1 ? '' : 's'}` : ''}
			</button>
		{/if}
	</div>
</section>
