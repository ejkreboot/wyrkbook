<script lang="ts">
	import { onMount } from 'svelte';
	import type { RealtimeChannel } from '@supabase/supabase-js';
	import { supabaseBrowser } from '$lib/supabaseBrowser';

	/**
	 * Photos taken on a phone, arriving here as they are sent.
	 *
	 * The desktop browser cannot always see an iPhone as a camera (Chrome does
	 * not list Continuity Camera), so this shows a QR code for the phone page
	 * instead. Each upload is announced on a private Realtime channel; this pulls
	 * the page through the app, hands it over like a picked file, and deletes it
	 * from storage. Whatever is still waiting when this closes — panel shut,
	 * outline started, page left or tab closed — is deleted too. See migration 011.
	 */
	let {
		resourceId,
		url,
		qr,
		topic,
		remaining,
		oncapture,
		onclose
	}: {
		resourceId: string;
		/** The phone page, spelled out under the QR for anyone who would rather type it. */
		url: string;
		/** An SVG string, made on the server from `url`. */
		qr: string;
		/** `outline-pages:<teacher uid>:<resource id>`. */
		topic: string;
		/** Pages still allowed; later arrivals are discarded at zero. */
		remaining: number;
		oncapture: (file: File) => void | Promise<void>;
		onclose: () => void;
	} = $props();

	let live = $state<'connecting' | 'ready' | 'offline'>('connecting');
	let received = $state(0);
	let problem = $state('');

	const base = $derived(`/api/outline/pages/${resourceId}`);
	const seen = new Set<string>();
	let closed = false;

	/** One page at a time, oldest first — arrival order is page order. */
	let chain = Promise.resolve();

	function take(names: string[]) {
		for (const name of names) {
			if (seen.has(name)) continue;
			seen.add(name);
			chain = chain.then(() => takeOne(name));
		}
	}

	async function takeOne(name: string) {
		if (closed) return;
		try {
			if (remaining <= 0) {
				problem = 'Page limit reached — photos sent after that were discarded.';
			} else {
				const res = await fetch(`${base}/${name}`);
				// Gone already: another tab took it, or it was cleared.
				if (!res.ok) return;
				const blob = await res.blob();
				if (closed) return;
				await oncapture(new File([blob], `phone-${name}`, { type: 'image/jpeg' }));
				received++;
			}
			await fetch(`${base}/${name}`, { method: 'DELETE' });
		} catch {
			// Left in storage; the next catch-up will try it again.
			seen.delete(name);
			problem = 'A page could not be fetched. Check your connection.';
		}
	}

	async function catchUp() {
		try {
			const res = await fetch(base);
			if (res.ok) take(((await res.json()) as { pages: string[] }).pages);
		} catch {
			problem = 'Could not check for pages. Check your connection.';
		}
	}

	/** `keepalive` lets the request outlive the page when the tab is closing. */
	function clearWaiting() {
		fetch(base, { method: 'DELETE', keepalive: true }).catch(() => {
			// Pruned server-side after an hour regardless.
		});
	}

	onMount(() => {
		const sb = supabaseBrowser();
		let channel: RealtimeChannel | undefined;

		(async () => {
			// Private channels are authorised by the teacher's JWT, read from the session cookie.
			await sb.realtime.setAuth();
			if (closed) return;
			channel = sb
				.channel(topic, { config: { private: true } })
				.on('broadcast', { event: 'page' }, ({ payload }) => {
					if (typeof payload?.name === 'string') take([payload.name]);
				})
				.subscribe((status) => {
					if (status === 'SUBSCRIBED') {
						live = 'ready';
						// Anything sent before the channel was up, or while it was down.
						catchUp();
					} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
						live = 'offline';
					}
				});
		})().catch(() => (live = 'offline'));

		window.addEventListener('pagehide', clearWaiting);
		return () => {
			closed = true;
			window.removeEventListener('pagehide', clearWaiting);
			if (channel) sb.removeChannel(channel);
			clearWaiting();
		};
	});
</script>

<div class="stack phone" role="group" aria-label="Phone">
	<div class="row" style="gap:1rem;align-items:flex-start;flex-wrap:wrap">
		<div class="phone-qr" aria-hidden="true">{@html qr}</div>
		<div class="stack" style="gap:.4rem;flex:1 1 14rem">
			<strong>Scan with your phone's camera</strong>
			<span class="muted small">
				It opens a page for taking photos of this resource's textbook pages. Sign in there if asked,
				with this same account. Each photo shows up here as soon as it's sent.
			</span>
			<span class="muted small" style="word-break:break-all">{url}</span>
		</div>
	</div>

	<div class="row" style="gap:.6rem;align-items:center;flex-wrap:wrap">
		<span class="small" role="status">
			{#if live === 'connecting'}
				<span class="spinner"></span> Connecting…
			{:else if live === 'offline'}
				Live updates aren't connecting.
			{:else if received}
				{received} page{received === 1 ? '' : 's'} received. Waiting for more…
			{:else}
				Waiting for photos…
			{/if}
		</span>
		{#if live === 'offline'}
			<button class="btn btn-sm" type="button" onclick={catchUp}>Check for photos</button>
		{/if}
		<button class="btn btn-ghost btn-sm" type="button" onclick={onclose}>Done</button>
	</div>

	{#if problem}
		<div class="alert alert-bad" role="alert">{problem}</div>
	{/if}
</div>

<style>
	.phone-qr {
		width: 9rem;
		padding: 0.5rem;
		background: #fff;
		border-radius: 6px;
		line-height: 0;
	}
	.phone-qr :global(svg) {
		width: 100%;
		height: auto;
	}
</style>
