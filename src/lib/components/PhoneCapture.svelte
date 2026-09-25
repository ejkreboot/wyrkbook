<script lang="ts">
	import { onMount } from 'svelte';
	import type { RealtimeChannel } from '@supabase/supabase-js';
	import { supabaseBrowser } from '$lib/supabaseBrowser';

	/**
	 * A QR code for sending pages from a phone, and the pages as they arrive.
	 *
	 * The desktop browser cannot always see an iPhone as a camera (Chrome does
	 * not list Continuity Camera), so the phone takes the photos in its own
	 * browser instead. The code opens /phone/<id> with a signed link that expires
	 * after two hours; a fresh one is fetched every half hour so the code on screen
	 * is never stale. Each upload is announced on a private Realtime channel; this
	 * pulls the page through the app, hands it over like a picked file, and deletes
	 * it from storage. The folder is emptied when this starts listening and again
	 * when it stops — outline started, generator closed, page left or tab closed.
	 * See migration 011.
	 */
	let {
		resourceId,
		remaining,
		oncapture
	}: {
		resourceId: string;
		/** Pages still allowed; later arrivals are discarded at zero. */
		remaining: number;
		oncapture: (file: File) => void | Promise<void>;
	} = $props();

	const REFRESH_MS = 30 * 60 * 1000;

	let qr = $state('');
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

	async function refreshLink(): Promise<string | undefined> {
		try {
			const res = await fetch(`${base}/link`);
			if (!res.ok) throw new Error();
			const link = (await res.json()) as { qr: string; topic: string };
			qr = link.qr;
			return link.topic;
		} catch {
			problem = 'The phone code could not be made. Reload the page to try again.';
		}
	}

	/** `keepalive` lets the request outlive the page when the tab is closing. */
	function clearWaiting() {
		return fetch(base, { method: 'DELETE', keepalive: true }).catch(() => {
			// Pruned server-side after an hour regardless.
		});
	}

	onMount(() => {
		const sb = supabaseBrowser();
		let channel: RealtimeChannel | undefined;
		const timer = setInterval(refreshLink, REFRESH_MS);

		(async () => {
			// Whatever is waiting is from an earlier session, not this one. Cleared
			// before the code is shown, so it cannot catch this session's first page.
			await clearWaiting();
			const topic = await refreshLink();
			if (!topic || closed) return;
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
			clearInterval(timer);
			window.removeEventListener('pagehide', clearWaiting);
			if (channel) sb.removeChannel(channel);
			clearWaiting();
		};
	});
</script>

<div class="phone-tile" role="group" aria-label="Send pages from your phone">
	<div class="phone-qr" aria-hidden="true">
		{#if qr}{@html qr}{/if}
	</div>
	<span class="small" style="font-weight:600">Or scan with your phone</span>
	<span class="muted small" role="status">
		{#if live === 'connecting'}
			Connecting…
		{:else if live === 'offline'}
			Not connected.
		{:else if received}
			{received} received
		{:else}
			Photos appear here
		{/if}
	</span>
	{#if live === 'offline'}
		<button class="btn btn-sm" type="button" onclick={catchUp}>Check for photos</button>
	{/if}
	{#if problem}
		<span class="small" style="color:var(--bad)" role="alert">{problem}</span>
	{/if}
</div>
