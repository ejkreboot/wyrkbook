<script lang="ts" module>
	export type TableChoice = {
		/** Rows, the header row among them. */
		rows: number;
		cols: number;
		/** Percent of the page's width, or null to fit the contents. */
		width: number | null;
	};

	export const MAX_ROWS = 50;
	export const MAX_COLS = 12;
</script>

<script lang="ts">
	/**
	 * Picks a new table's size and width, or — `editing` — a table's width.
	 * Opens as a modal just below `anchor` (a point on screen, the cursor's) and
	 * calls `onclose` once: with the choice, or null for Cancel or Escape.
	 */
	import { onMount } from 'svelte';
	import { clampWidth } from '$lib/markdown';

	let {
		initial,
		editing = false,
		anchor,
		onclose
	}: {
		initial: TableChoice;
		editing?: boolean;
		anchor: { left: number; top: number; bottom: number };
		onclose: (choice: TableChoice | null) => void;
	} = $props();

	const GRID_ROWS = 8;
	const GRID_COLS = 8;

	// svelte-ignore state_referenced_locally
	let rows = $state(initial.rows);
	// svelte-ignore state_referenced_locally
	let cols = $state(initial.cols);
	// svelte-ignore state_referenced_locally
	let fit = $state(initial.width === null);
	// svelte-ignore state_referenced_locally
	let percent = $state(initial.width ?? 100);
	let hover = $state<{ r: number; c: number } | null>(null);

	let dialog: HTMLDialogElement;
	let first = $state<HTMLInputElement>();
	let closed = false;
	let pressedOutside = false;

	const clampInt = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n) || lo));
	const shownRows = $derived(hover?.r ?? rows);
	const shownCols = $derived(hover?.c ?? cols);

	onMount(() => {
		dialog.showModal();
		// Below the cursor, or above it if there is no room, and kept on screen.
		const box = dialog.getBoundingClientRect();
		const gap = 8;
		const below = anchor.bottom + gap;
		const top = below + box.height <= innerHeight - gap ? below : Math.max(gap, anchor.top - gap - box.height);
		const left = Math.min(Math.max(gap, anchor.left - 24), innerWidth - box.width - gap);
		dialog.style.top = `${top}px`;
		dialog.style.left = `${Math.max(gap, left)}px`;
		// The rows field, or with only the width to choose, the width that is set.
		if (first) first.select();
		else dialog.querySelector<HTMLInputElement>('input:checked')?.focus();
	});

	function finish(choice: TableChoice | null) {
		if (closed) return;
		closed = true;
		dialog.close();
		onclose(choice);
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		finish({
			rows: clampInt(rows, 1, MAX_ROWS),
			cols: clampInt(cols, 1, MAX_COLS),
			width: fit ? null : clampWidth(percent || 100)
		});
	}
</script>

<dialog
	bind:this={dialog}
	class="table-dialog"
	aria-label={editing ? 'Table width' : 'Insert table'}
	oncancel={(e) => {
		e.preventDefault();
		finish(null);
	}}
	onpointerdown={(e) => (pressedOutside = e.target === dialog)}
	onclick={(e) => {
		// A click on the backdrop, outside the box — not the end of the click that opened it.
		if (e.target === dialog && pressedOutside) finish(null);
	}}
>
	<form onsubmit={submit}>
		{#if !editing}
			<div class="size">
				<div
					class="grid"
					role="grid"
					aria-label="Rows and columns"
					tabindex="-1"
					onpointerleave={() => (hover = null)}
					style:--cols={GRID_COLS}
				>
					{#each { length: GRID_ROWS } as _, r (r)}
						{#each { length: GRID_COLS } as _, c (c)}
							<button
								type="button"
								tabindex="-1"
								class="cell"
								class:header={r === 0}
								class:on={r < shownRows && c < shownCols}
								aria-label="{r + 1} rows by {c + 1} columns"
								onpointerenter={() => (hover = { r: r + 1, c: c + 1 })}
								onclick={() => {
									rows = r + 1;
									cols = c + 1;
								}}
								ondblclick={() => {
									rows = r + 1;
									cols = c + 1;
									dialog.querySelector('form')?.requestSubmit();
								}}
							></button>
						{/each}
					{/each}
				</div>
				<p class="hint">{shownRows} × {shownCols} — the first row is the header</p>
			</div>

			<div class="counts">
				<label>
					<span>Rows</span>
					<input type="number" min="1" max={MAX_ROWS} bind:value={rows} bind:this={first} required />
				</label>
				<label>
					<span>Columns</span>
					<input type="number" min="1" max={MAX_COLS} bind:value={cols} required />
				</label>
			</div>
		{/if}

		<fieldset class="width">
			<legend>Width</legend>
			<label class="check">
				<input
					type="radio"
					name="width"
					checked={fit}
					onchange={() => (fit = true)}
				/>
				<span>Fit to contents</span>
			</label>
			<label class="check">
				<input type="radio" name="width" checked={!fit} onchange={() => (fit = false)} />
				<span>Share of the page</span>
			</label>
			<div class="percent" class:off={fit}>
				<input
					type="range"
					min="10"
					max="100"
					step="5"
					bind:value={percent}
					aria-label="Width, percent of the page"
					oninput={() => (fit = false)}
				/>
				<label class="num">
					<input
						type="number"
						min="10"
						max="100"
						bind:value={percent}
						aria-label="Width, percent of the page"
						onfocus={() => (fit = false)}
					/>
					<span>%</span>
				</label>
			</div>
		</fieldset>

		<div class="btn-row actions">
			<button type="button" class="btn btn-sm" onclick={() => finish(null)}>Cancel</button>
			<button type="submit" class="btn btn-sm btn-primary">{editing ? 'Apply' : 'Insert table'}</button>
		</div>
	</form>
</dialog>

<style>
	.table-dialog {
		position: fixed;
		margin: 0;
		width: 300px;
		max-width: calc(100vw - 16px);
		padding: 1rem;
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--line);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lg);
		font-size: .9rem;
	}
	.table-dialog::backdrop { background: transparent; }
	form { display: grid; gap: .9rem; }

	.grid {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: 3px;
		width: max-content;
	}
	.cell {
		width: 22px;
		height: 18px;
		padding: 0;
		border: 1px solid var(--line-strong);
		border-radius: 2px;
		background: var(--card);
		cursor: pointer;
	}
	.cell.header { background: var(--paper-2); }
	.cell.on { background: var(--accent-soft); border-color: var(--accent); }
	.cell.on.header { background: color-mix(in srgb, var(--accent) 35%, var(--accent-soft)); }
	.size .hint { margin: .4rem 0 0; }

	.counts { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
	.counts label { display: grid; gap: .2rem; }
	.counts span { font-size: .78rem; color: var(--ink-2); font-weight: 600; }
	.counts input { min-height: 36px; padding: .3rem .5rem; font-size: .95rem; }

	.width { border: 0; margin: 0; padding: 0; display: grid; gap: .35rem; }
	.width legend { font-size: .78rem; color: var(--ink-2); font-weight: 600; padding: 0; margin-bottom: .3rem; }
	.width .check { align-items: center; }
	.width input[type='radio'] { accent-color: var(--accent); margin: 0; }
	.percent { display: flex; align-items: center; gap: .6rem; padding-left: 1.4rem; }
	.percent.off { opacity: .5; }
	.percent input[type='range'] { flex: 1; accent-color: var(--accent); }
	.num { display: flex; align-items: center; gap: .25rem; }
	.num input { width: 4.2rem; min-height: 32px; padding: .2rem .4rem; font-size: .95rem; }

	.actions { justify-content: flex-end; }
</style>
