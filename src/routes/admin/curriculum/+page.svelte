<script lang="ts">
	import { weekLabel } from '$lib/week';

	let { data, form } = $props();

	const shown = $derived(
		data.classFilter ? data.classes.filter((c) => c.id === data.classFilter) : data.classes
	);

	const byClass = $derived.by(() => {
		const m = new Map<string, typeof data.resources>();
		for (const r of data.resources) m.set(r.class_id, [...(m.get(r.class_id) ?? []), r]);
		return m;
	});
</script>

<div class="wrap stack">
	<div class="row-between">
		<h1>Curriculum</h1>
		<form method="GET" class="row">
			<select name="class" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				<option value="">All classes</option>
				{#each data.classes as c (c.id)}
					<option value={c.id} selected={c.id === data.classFilter}>{c.name}</option>
				{/each}
			</select>
			<noscript><button class="btn btn-sm" type="submit">Filter</button></noscript>
		</form>
	</div>

	{#if form?.message}
		<div class="alert alert-bad">{form.message}</div>
	{/if}

	{#if data.classes.length}
		<form method="POST" action="?/create" class="card inline-form">
			<div class="field" style="flex:2 1 16rem">
				<label for="new-title">New resource</label>
				<input id="new-title" name="title" type="text" placeholder="Lecture 3 — the chain rule" required />
			</div>
			<div class="field" style="flex:1 1 10rem">
				<label for="new-class">Class</label>
				<select id="new-class" name="class_id" required>
					{#each data.classes as c (c.id)}
						<option value={c.id} selected={c.id === data.classFilter}>{c.name}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<button class="btn btn-primary" type="submit">+ Create</button>
			</div>
		</form>
	{/if}

	{#each shown as k (k.id)}
		{@const list = byClass.get(k.id) ?? []}
		<div class="card card-flush tagged" style="--tag: var(--c-{k.color})">
			<div class="card-head" style="padding:.75rem 1rem">
				<span class="card-title">{k.name}</span>
				<span class="muted small">{list.length} resource{list.length === 1 ? '' : 's'}</span>
			</div>
			{#if list.length}
				<ul class="list">
					{#each list as r (r.id)}
						<li>
							<div class="list-main">
								<div class="list-title"><a href="/admin/curriculum/{r.id}">{r.title}</a></div>
								<div class="list-sub">
									{r.week_start ? weekLabel(r.week_start) : 'No week'}
								</div>
							</div>
							<a class="btn btn-sm no-print" href="/admin/curriculum/{r.id}/print?notes=0">Handout</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="muted small" style="margin:0;padding:0 1rem 1rem">Nothing here yet.</p>
			{/if}
		</div>
	{:else}
		<div class="empty">
			<h3>No classes yet</h3>
			<p>Curriculum resources belong to a class. Add one on the Classes page first.</p>
			<a class="btn btn-primary" href="/admin/classes">Go to Classes</a>
		</div>
	{/each}
</div>
