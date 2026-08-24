<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	/*
	 * Two audiences, one door. Teachers get a code in the mail; students, who
	 * mostly have no inbox to get it in, get a username and a password. Which
	 * question to ask is the server's to answer — /login/mode answers it as the
	 * identifier is typed so the password box is already there by the time they
	 * reach for it, and the `start` action answers it on submit when there is no
	 * JavaScript to ask with.
	 */
	let liveMode = $state<'password' | 'otp' | null>(null);
	// Seeded from `form`, not derived from it: this is what the person is typing.
	// The initial value only matters on the no-JavaScript path, where the whole
	// component is remounted after each submit and would otherwise come back blank.
	let identifier = $state(form?.identifier ?? '');
	let sending = $state(false);

	const serverStage = $derived(form?.stage ?? 'request');
	const stage = $derived(
		serverStage === 'request' && liveMode === 'password' ? 'password' : serverStage
	);
	const askingPassword = $derived(stage === 'password');

	/*
	 * Mirrors profile_username_format (migration 008) and the shape of an address.
	 * Used for two things: keeping the submit button off until there is something
	 * worth submitting, and not spending a rate-limited lookup on half a word.
	 */
	const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
	const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

	const identifierOk = $derived.by(() => {
		const value = identifier.trim().toLowerCase();
		return USERNAME_RE.test(value) || EMAIL_RE.test(value);
	});

	let lookup = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function detect() {
		const value = identifier.trim().toLowerCase();
		if (!identifierOk) {
			liveMode = null;
			return;
		}
		// Late answers to superseded questions would flip the form under the
		// person typing, so only the newest lookup is allowed to land.
		const mine = ++lookup;
		try {
			const res = await fetch('/login/mode', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ identifier: value })
			});
			const { mode } = await res.json();
			if (mine === lookup) liveMode = mode;
		} catch {
			// Offline or blocked: fall back to the submit-time fork, which is the
			// same decision made one round trip later.
		}
	}

	function onIdentifierInput() {
		clearTimeout(timer);
		liveMode = null;
		timer = setTimeout(detect, 350);
	}

	const submitting = () => {
		sending = true;
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			/*
			 * `reset: false` matters. An enhanced submit resets the form on success,
			 * and `start` succeeding is what moves a student to the password stage —
			 * so the default would clear the username they just typed out from under
			 * them, on the one path where they still need it. Which is to say: it
			 * happened to anyone who clicked Continue before the lookup landed.
			 */
			await update({ reset: false });
			sending = false;
		};
	};
</script>

<div class="wrap wrap-narrow" style="padding-top:3rem">
	<div class="center" style="margin-bottom:1.5rem">
		<img class="login-mark" src="/logo.png" alt="" width="400" height="311" />
		<h1 style="font-size:2.2rem">wyrkbook<span style="color:var(--accent)">.</span></h1>
		<p class="muted small">Homeschool, organized by the week.</p>
	</div>

	<div class="card">
		{#if data.notice}
			<div class="alert alert-warn" style="margin-bottom:1rem">{data.notice}</div>
		{/if}
		{#if form?.message}
			<div class="alert alert-bad" style="margin-bottom:1rem">{form.message}</div>
		{/if}

		{#if stage === 'request' || stage === 'password'}
			<h2 style="margin-bottom:.25rem">Sign in</h2>
			<p class="muted small" style="margin-bottom:1rem">
				{#if askingPassword}
					Type the password you chose.
				{:else}
					Students sign in with their username. Teachers, use your email.
				{/if}
			</p>

			<form method="POST" action={askingPassword ? '?/password' : '?/start'} use:enhance={submitting}>
				<input type="hidden" name="next" value={form?.next ?? data.next} />
				<div class="field">
					<label for="identifier">Username or email</label>
					<input
						id="identifier"
						name="identifier"
						type="text"
						autocomplete="username"
						autocapitalize="none"
						spellcheck="false"
						required
						bind:value={identifier}
						oninput={onIdentifierInput}
						onblur={detect}
						placeholder="jamie  ·  you@example.com"
					/>
				</div>

				{#if askingPassword}
					<div class="field">
						<label for="password">Password</label>
						<input
							id="password"
							name="password"
							type="password"
							autocomplete="current-password"
							required
						/>
					</div>
				{/if}

				<button
					class="btn btn-primary btn-block"
					type="submit"
					disabled={sending || !identifierOk}
				>
					{#if sending}<span class="spinner"></span> Just a moment…
					{:else if askingPassword}Sign in
					{:else}Continue{/if}
				</button>

				{#if askingPassword}
					<!-- Same form, different action: the username is already in it, and
					     this way it works with JavaScript off too. `formnovalidate` because
					     the point of this button is that the password box is empty — without
					     it the browser blocks the submit demanding the very thing they came
					     here to say they don't have. -->
					<button
						class="btn btn-ghost btn-block btn-sm"
						type="submit"
						formaction="?/forgot"
						formnovalidate
						disabled={sending || !identifierOk}
						style="margin-top:.75rem"
					>
						I forgot my password
					</button>
				{/if}
			</form>
		{:else if stage === 'verify'}
			<h2 style="margin-bottom:.25rem">Check your email</h2>
			<p class="muted small" style="margin-bottom:1rem">
				We sent a code to <strong>{form?.identifier}</strong>.
			</p>

			<form method="POST" action="?/verify" use:enhance={submitting}>
				<input type="hidden" name="identifier" value={form?.identifier} />
				<input type="hidden" name="next" value={form?.next ?? data.next} />
				<div class="field">
					<label for="token">Sign-in code</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="token"
						name="token"
						class="otp-input"
						type="text"
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength="10"
						pattern="[0-9]*"
						required
						autofocus
					/>
				</div>
				<button class="btn btn-primary btn-block" type="submit" disabled={sending}>
					{#if sending}<span class="spinner"></span> Checking…{:else}Sign in{/if}
				</button>
			</form>

			<form method="POST" action="?/request" style="margin-top:.75rem">
				<input type="hidden" name="identifier" value={form?.identifier} />
				<input type="hidden" name="next" value={form?.next ?? data.next} />
				<button class="btn btn-ghost btn-block btn-sm" type="submit">Send a new code</button>
			</form>
		{:else if stage === 'pin'}
			<h2 style="margin-bottom:.25rem">Ask your teacher</h2>
			<p class="muted small" style="margin-bottom:1rem">
				Your teacher has a six-digit reset code for you on their People page. Type it in
				here and you can pick a new password. Nobody but you will know it.
			</p>

			<form method="POST" action="?/pin" use:enhance={submitting}>
				<input type="hidden" name="identifier" value={form?.identifier} />
				<input type="hidden" name="next" value={form?.next ?? data.next} />
				<div class="field">
					<label for="pin">Reset code</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="pin"
						name="pin"
						class="otp-input"
						type="text"
						inputmode="numeric"
						maxlength="6"
						pattern="[0-9]*"
						required
						autofocus
					/>
				</div>
				<button class="btn btn-primary btn-block" type="submit" disabled={sending}>
					{#if sending}<span class="spinner"></span> Checking…{:else}Continue{/if}
				</button>
			</form>

			<p class="muted small center" style="margin-top:.75rem">
				<a href="/login">Back to sign in</a>
			</p>
		{:else if stage === 'choose'}
			<h2 style="margin-bottom:.25rem">Pick a new password</h2>
			<p class="muted small" style="margin-bottom:1rem">
				Choose something you'll remember. Keep it to yourself — your teacher doesn't
				need it and can't see it.
			</p>

			<form method="POST" action="?/reset" use:enhance={submitting}>
				<input type="hidden" name="identifier" value={form?.identifier} />
				<input type="hidden" name="pin" value={form?.pin} />
				<input type="hidden" name="next" value={form?.next ?? data.next} />
				<div class="field">
					<label for="new-password">New password</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="new-password"
						name="password"
						type="password"
						autocomplete="new-password"
						minlength="6"
						required
						autofocus
					/>
				</div>
				<div class="field">
					<label for="confirm">Type it again</label>
					<input
						id="confirm"
						name="confirm"
						type="password"
						autocomplete="new-password"
						minlength="6"
						required
					/>
				</div>
				<button class="btn btn-primary btn-block" type="submit" disabled={sending}>
					{#if sending}<span class="spinner"></span> Saving…{:else}Save and sign in{/if}
				</button>
			</form>
		{/if}
	</div>
</div>
