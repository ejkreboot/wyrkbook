<script lang="ts">
	import { enhance } from '$app/forms';
	import type { WeeklyGoal } from '$lib/types';

	let {
		goals = [],
		color = 'slate',
		classId,
		week
	}: { goals: WeeklyGoal[]; color?: string; classId: string; week: string } = $props();

	let adding = $state(false);
	let title = $state('');
</script>

<ul class="goal-list">
	{#each goals as g (g.id)}
		<li class="goal {g.done ? 'is-done' : ''}" style="--tag: var(--c-{color})">
			<form method="POST" action="?/toggleGoal" use:enhance style="display:flex;align-items:center">
				<input type="hidden" name="id" value={g.id} />
				<input type="hidden" name="done" value={String(!g.done)} />
				<button
					class="btn btn-ghost btn-sm"
					type="submit"
					style="min-height:22px;padding:0 .2rem"
					aria-label={g.done ? 'Mark not done' : 'Mark done'}
				>
					{g.done ? '☑' : '☐'}
				</button>
			</form>

			<div style="flex:1;min-width:0">
				<div class="goal-title">{g.title}</div>
				{#if g.detail}<div class="goal-detail">{g.detail}</div>{/if}
			</div>

			<form method="POST" action="?/deleteGoal" use:enhance>
				<input type="hidden" name="id" value={g.id} />
				<button
					class="btn btn-ghost btn-sm"
					type="submit"
					style="min-height:22px;padding:0 .3rem;color:var(--ink-3)"
					aria-label="Delete goal">×</button
				>
			</form>
		</li>
	{/each}
</ul>

{#if adding}
	<form
		method="POST"
		action="?/addGoal"
		use:enhance={() => async ({ update }) => {
			await update({ reset: true });
			title = '';
			adding = false;
		}}
		style="margin-top:.5rem"
	>
		<input type="hidden" name="class_id" value={classId} />
		<input type="hidden" name="week_start" value={week} />
		<div class="field" style="margin-bottom:.4rem">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				name="title"
				type="text"
				bind:value={title}
				placeholder="Finish Ch. 4 review problems"
				required
				autofocus
			/>
		</div>
		<div class="btn-row">
			<button class="btn btn-primary btn-sm" type="submit">Add goal</button>
			<button class="btn btn-ghost btn-sm" type="button" onclick={() => (adding = false)}>
				Cancel
			</button>
		</div>
	</form>
{:else}
	<button class="btn btn-ghost btn-sm" style="margin-top:.4rem" onclick={() => (adding = true)}>
		+ Add goal
	</button>
{/if}
