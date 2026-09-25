<script lang="ts">
	import { onDestroy } from 'svelte';
	import { shrinkImage } from '$lib/shrinkImage';

	let { data } = $props();

	/** Comfortably under Vercel's 4.5 MB body, and still ~2000 px of page. */
	const MAX_BYTES = 3_000_000;

	type Shot = { preview: string; file: File; state: 'waiting' | 'sending' | 'sent' | 'failed'; problem?: string };
	let shots = $state<Shot[]>([]);

	/*
	 * One upload at a time, in the order taken: the server names each page by
	 * the time it arrives, and that name is the page order on the desktop.
	 */
	let queue = Promise.resolve();

	function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const picked = Array.from(input.files ?? []);
		input.value = '';
		for (const file of picked) {
			shots.push({ preview: URL.createObjectURL(file), file, state: 'waiting' });
			const i = shots.length - 1;
			queue = queue.then(() => send(i));
		}
	}

	async function send(i: number) {
		const shot = shots[i];
		shot.state = 'sending';
		shot.problem = undefined;
		try {
			const small = await shrinkImage(shot.file, { maxBytes: MAX_BYTES });
			const form = new FormData();
			form.append('image', small);
			form.append('t', data.token);
			const res = await fetch(`/phone/${data.resourceId}/upload`, { method: 'POST', body: form });
			if (!res.ok) throw new Error(await reason(res));
			shot.state = 'sent';
		} catch (err) {
			shot.state = 'failed';
			shot.problem = (err as Error).message || 'Not sent.';
		}
	}

	function retry(i: number) {
		queue = queue.then(() => send(i));
	}

	async function reason(res: Response) {
		try {
			return (await res.json()).message ?? `Not sent (${res.status}).`;
		} catch {
			return `Not sent (${res.status}).`;
		}
	}

	onDestroy(() => {
		for (const s of shots) URL.revokeObjectURL(s.preview);
	});

	const sent = $derived(shots.filter((s) => s.state === 'sent').length);
</script>

<svelte:head><title>Pages · {data.title}</title></svelte:head>

<section class="wrap stack" style="max-width:32rem">
	<div class="stack" style="gap:.2rem">
		<h1 style="margin:0">Textbook pages</h1>
		<p class="muted" style="margin:0">for <strong>{data.title}</strong></p>
	</div>

	<p class="muted small" style="margin:0">
		Each photo appears on your computer as soon as it is sent. Take them in page order, straight
		on, in good light. Keep the outline generator open there until you're done. This link works
		for two hours.
	</p>

	<label class="btn btn-primary shoot" for="phone-shot">
		<span aria-hidden="true">📷</span>
		<span>{shots.length ? 'Take the next page' : 'Take a photo'}</span>
	</label>
	<input id="phone-shot" class="sr-only" type="file" accept="image/*" capture="environment" onchange={onPick} />

	<label class="btn btn-sm" for="phone-pick" style="align-self:flex-start">Choose from photos…</label>
	<input id="phone-pick" class="sr-only" type="file" accept="image/*" multiple onchange={onPick} />

	{#if shots.length}
		<p class="small" style="margin:0" role="status">
			{sent} of {shots.length} sent{sent < shots.length ? '…' : '.'}
		</p>
		<div class="thumb-grid">
			{#each shots as s, i (s.preview)}
				<div class="thumb">
					<img src={s.preview} alt="Page {i + 1}" style:opacity={s.state === 'sent' ? 1 : 0.5} />
					<span class="thumb-n">{s.state === 'sent' ? '✓' : s.state === 'failed' ? '!' : i + 1}</span>
				</div>
			{/each}
		</div>
		{#each shots as s, i (s.preview)}
			{#if s.state === 'failed'}
				<div class="alert alert-bad row-between" role="alert">
					<span>Page {i + 1}: {s.problem}</span>
					<button class="btn btn-sm" type="button" onclick={() => retry(i)}>Retry</button>
				</div>
			{/if}
		{/each}
	{/if}
</section>

<style>
	/* The one thing to press on this page: a big, solid thumb target. */
	.shoot {
		width: 100%;
		min-height: 3.5rem;
		font-size: 1.1rem;
	}
</style>
