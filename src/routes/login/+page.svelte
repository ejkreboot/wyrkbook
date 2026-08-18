<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	// The page is a two-step wizard held entirely in form state: ask for the
	// address, then ask for the code that just landed in the inbox.
	const stage = $derived(form?.stage === 'verify' && !form?.message ? 'verify' : (form?.stage === 'verify' ? 'verify' : 'request'));
	const email = $derived(form?.email ?? '');
	let sending = $state(false);
</script>

<div class="wrap wrap-narrow" style="padding-top:3rem">
	<div class="center" style="margin-bottom:1.5rem">
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

		{#if stage === 'request'}
			<h2 style="margin-bottom:.25rem">Sign in</h2>
			<p class="muted small" style="margin-bottom:1rem">
				We'll email you a 6-digit code. No password to remember.
			</p>

			<form
				method="POST"
				action="?/request"
				use:enhance={() => {
					sending = true;
					return async ({ update }) => {
						await update();
						sending = false;
					};
				}}
			>
				<input type="hidden" name="next" value={data.next} />
				<div class="field">
					<label for="email">Email address</label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						inputmode="email"
						required
						value={email}
						placeholder="you@example.com"
					/>
				</div>
				<button class="btn btn-primary btn-block" type="submit" disabled={sending}>
					{#if sending}<span class="spinner"></span> Sending…{:else}Email me a code{/if}
				</button>
			</form>
		{:else}
			<h2 style="margin-bottom:.25rem">Check your email</h2>
			<p class="muted small" style="margin-bottom:1rem">
				We sent a code to <strong>{email}</strong>.
			</p>

			<form
				method="POST"
				action="?/verify"
				use:enhance={() => {
					sending = true;
					return async ({ update }) => {
						await update();
						sending = false;
					};
				}}
			>
				<input type="hidden" name="email" value={email} />
				<input type="hidden" name="next" value={form?.next ?? data.next} />
				<div class="field">
					<label for="token">6-digit code</label>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						id="token"
						name="token"
						class="otp-input"
						type="text"
						inputmode="numeric"
						autocomplete="one-time-code"
						maxlength="6"
						pattern="[0-9]*"
						required
						autofocus
						placeholder="······"
					/>
				</div>
				<button class="btn btn-primary btn-block" type="submit" disabled={sending}>
					{#if sending}<span class="spinner"></span> Checking…{:else}Sign in{/if}
				</button>
			</form>

			<form method="POST" action="?/request" style="margin-top:.75rem">
				<input type="hidden" name="email" value={email} />
				<input type="hidden" name="next" value={form?.next ?? data.next} />
				<button class="btn btn-ghost btn-block btn-sm" type="submit">
					Send a new code
				</button>
			</form>
		{/if}
	</div>
</div>
