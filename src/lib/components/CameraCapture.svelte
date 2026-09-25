<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	/**
	 * A live camera view that captures still frames as JPEG files.
	 *
	 * On a phone the file input's `capture` attribute already opens the camera;
	 * this exists for the desktop, where it does not. Any webcam works, and on a
	 * Mac that includes a nearby iPhone through Continuity Camera (macOS 13+,
	 * same Apple ID, phone locked, in landscape, rear camera facing the page),
	 * which shows up in the camera list like any other.
	 */
	let {
		remaining,
		oncapture,
		onclose
	}: {
		/** Pages still allowed; capture is disabled at zero. */
		remaining: number;
		oncapture: (file: File) => void;
		onclose: () => void;
	} = $props();

	const DEVICE_KEY = 'wyrkbook:camera-device';

	let video = $state<HTMLVideoElement>();
	let stream = $state.raw<MediaStream>();
	let devices = $state<MediaDeviceInfo[]>([]);
	let deviceId = $state('');
	let rotation = $state(0);
	let problem = $state('');
	let size = $state('');
	let flash = $state(false);
	let taken = 0;

	$effect(() => {
		if (video) video.srcObject = stream ?? null;
	});

	function stopStream() {
		for (const track of stream?.getTracks() ?? []) track.stop();
		stream = undefined;
		size = '';
	}

	async function start(id: string) {
		stopStream();
		problem = '';
		try {
			// `ideal`, not `exact`: the camera picks its nearest size, and bigger
			// frames are what make small print legible.
			stream = await navigator.mediaDevices.getUserMedia({
				audio: false,
				video: {
					...(id ? { deviceId: { exact: id } } : {}),
					width: { ideal: 3840 },
					height: { ideal: 2160 }
				}
			});
			const settings = stream.getVideoTracks()[0]?.getSettings();
			deviceId = settings?.deviceId ?? id;
			if (settings?.width && settings?.height) size = `${settings.width}×${settings.height}`;
			try {
				localStorage.setItem(DEVICE_KEY, deviceId);
			} catch {
				// Not remembered; harmless.
			}
			await listDevices();
		} catch (e) {
			problem = explain(e);
		}
	}

	/** Labels are only filled in once permission has been granted. */
	async function listDevices() {
		const all = await navigator.mediaDevices.enumerateDevices();
		devices = all.filter((d) => d.kind === 'videoinput');
	}

	function explain(e: unknown): string {
		const name = (e as DOMException)?.name;
		if (name === 'NotAllowedError') return 'Camera access was blocked. Allow it in the browser’s site settings, then try again.';
		if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found. If you meant your iPhone, bring it close, lock it, and pick it from the list.';
		if (name === 'NotReadableError') return 'That camera is in use by another app.';
		return 'The camera could not be started.';
	}

	const iphone = () => devices.find((d) => /iphone/i.test(d.label))?.deviceId;

	/** Prefers the last camera used here, then an iPhone, then whatever the browser offers. */
	async function startInitial() {
		let saved = '';
		try {
			saved = localStorage.getItem(DEVICE_KEY) ?? '';
		} catch {
			// Fall through to the other choices.
		}
		await listDevices();
		if (saved && devices.some((d) => d.deviceId === saved)) return start(saved);

		await start(iphone() ?? '');
		// The first time through, labels are blank until permission is granted, so
		// the iPhone could not be recognised before starting. Now it can.
		const found = iphone();
		if (found && found !== deviceId) await start(found);
	}

	onMount(() => {
		if (!navigator.mediaDevices?.getUserMedia) {
			problem = 'This browser can’t use a camera here. It needs a secure (https) connection.';
			return;
		}
		// An iPhone appears in the list only once it is near, locked and in landscape.
		navigator.mediaDevices.addEventListener('devicechange', listDevices);
		startInitial();
		return () => navigator.mediaDevices.removeEventListener('devicechange', listDevices);
	});

	onDestroy(stopStream);

	function rotate() {
		rotation = (rotation + 90) % 360;
	}

	async function capture() {
		if (!video || !stream || remaining <= 0) return;
		const w = video.videoWidth;
		const h = video.videoHeight;
		if (!w || !h) return;

		const sideways = rotation % 180 !== 0;
		const canvas = document.createElement('canvas');
		canvas.width = sideways ? h : w;
		canvas.height = sideways ? w : h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate((rotation * Math.PI) / 180);
		ctx.drawImage(video, -w / 2, -h / 2, w, h);

		const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
		if (!blob) {
			problem = 'That frame could not be captured. Try again.';
			return;
		}
		taken++;
		oncapture(new File([blob], `camera-${taken}.jpg`, { type: 'image/jpeg' }));
		flash = true;
		setTimeout(() => (flash = false), 180);
	}

	/**
	 * Space captures, so one hand can hold the book open. Keys typed into a field
	 * are left alone, and so is Space on a focused button, which clicks it anyway.
	 */
	function onKeydown(e: KeyboardEvent) {
		if (e.key !== ' ' || e.repeat) return;
		const el = e.target as HTMLElement | null;
		if (el?.closest('input, textarea, select, button, [contenteditable]')) return;
		e.preventDefault();
		capture();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="cam stack" role="group" aria-label="Camera">
	<div class="row" style="gap:.5rem;flex-wrap:wrap;align-items:center">
		<select
			aria-label="Camera"
			value={deviceId}
			onchange={(e) => start(e.currentTarget.value)}
			style="width:auto;flex:1 1 12rem"
		>
			{#if !devices.length}<option value="">Camera</option>{/if}
			{#each devices as d, i (d.deviceId)}
				<option value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>
			{/each}
		</select>
		<button class="btn btn-sm" type="button" onclick={rotate} title="Rotate the page upright">⟳ Rotate</button>
		<button class="btn btn-ghost btn-sm" type="button" onclick={onclose}>Done</button>
	</div>

	<div class="cam-view" class:cam-flash={flash}>
		<!-- svelte-ignore a11y_media_has_caption -->
		<video
			bind:this={video}
			autoplay
			playsinline
			muted
			style="transform:rotate({rotation}deg){rotation % 180 ? ' scale(.75)' : ''}"
		></video>
		{#if !stream && !problem}<span class="cam-wait muted small">Starting camera…</span>{/if}
	</div>

	{#if problem}
		<div class="alert alert-bad" role="alert">{problem}</div>
	{/if}

	<div class="row" style="gap:.6rem;align-items:center;flex-wrap:wrap">
		<button class="btn btn-primary" type="button" onclick={capture} disabled={!stream || remaining <= 0}>
			Capture page
		</button>
		<span class="muted small">
			{remaining <= 0 ? 'Page limit reached.' : 'Or press Space.'}
			{#if size}· {size}{/if}
		</span>
	</div>
	<p class="muted small" style="margin:0">
		To use your iPhone: same Apple ID as this Mac, phone locked and held in landscape with the
		rear camera facing the page, then pick it above. A stand over the open book works best.
	</p>
</div>
