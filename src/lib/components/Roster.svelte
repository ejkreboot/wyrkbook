<script lang="ts">
	import { enhance } from '$app/forms';

	/**
	 * One side of the roster, from either end. /admin/classes fixes the class and
	 * picks students; /admin/students fixes the student and picks classes. The
	 * shape is identical — a row of chips you can remove from and a select you can
	 * add from — so both pages render this and post to the same two actions.
	 */
	let {
		entries = [],
		options = [],
		fixed,
		pick,
		addLabel = 'Add',
		emptyLabel = 'Nobody yet.'
	}: {
		entries: { id: string; label: string; color?: string }[];
		options: { id: string; label: string }[];
		fixed: { name: 'class_id' | 'student_id'; value: string };
		pick: 'class_id' | 'student_id';
		addLabel?: string;
		emptyLabel?: string;
	} = $props();

	// Anyone already on the roster is not worth offering again.
	const taken = $derived(new Set(entries.map((e) => e.id)));
	const available = $derived(options.filter((o) => !taken.has(o.id)));

	let picked = $state('');
</script>

<div class="roster">
	{#if entries.length}
		<div class="roster-chips">
			{#each entries as e (e.id)}
				<!-- The chip is the remove form: a <form> inside a <span> would be
				     flow content inside phrasing content, so the chip is the form. -->
				<form
					method="POST"
					action="?/unenroll"
					use:enhance
					class="chip"
					style={e.color ? `--tag: var(--c-${e.color})` : ''}
				>
					<input type="hidden" name={fixed.name} value={fixed.value} />
					<input type="hidden" name={pick} value={e.id} />
					{#if e.color}<span class="chip-dot"></span>{/if}
					{e.label}
					<button class="chip-x" type="submit" aria-label="Remove {e.label}">×</button>
				</form>
			{/each}
		</div>
	{:else}
		<div class="card-note">{emptyLabel}</div>
	{/if}

	{#if available.length}
		<form
			method="POST"
			action="?/enroll"
			use:enhance={() => async ({ update }) => {
				await update({ reset: true });
				picked = '';
			}}
			class="roster-add"
		>
			<input type="hidden" name={fixed.name} value={fixed.value} />
			<select name={pick} bind:value={picked} required aria-label={addLabel}>
				<option value="" disabled>{addLabel}…</option>
				{#each available as o (o.id)}
					<option value={o.id}>{o.label}</option>
				{/each}
			</select>
			<button class="btn btn-sm" type="submit" disabled={!picked}>{addLabel}</button>
		</form>
	{/if}
</div>
