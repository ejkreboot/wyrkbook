<script lang="ts">
	import Roster from '$lib/components/Roster.svelte';

	let { data, form } = $props();
	let editing = $state<string | null>(null);

	const nameById = $derived(new Map(data.students.map((s) => [s.id, s.display_name])));

	/** class id -> the students on its roster, in the load's display-name order. */
	const rosterByClass = $derived.by(() => {
		const m = new Map<string, { id: string; label: string }[]>();
		for (const k of data.allClasses) m.set(k.id, []);
		for (const e of data.enrollments) {
			const label = nameById.get(e.student_id);
			if (label) m.get(e.class_id)?.push({ id: e.student_id, label });
		}
		return m;
	});

	const studentOptions = $derived(
		data.students.map((s) => ({ id: s.id, label: s.display_name }))
	);
</script>

<div class="wrap stack">
	<h1>Classes</h1>

	{#if form?.message}
		<div class="alert {form.ok ? 'alert-ok' : 'alert-bad'}">{form.message}</div>
	{/if}

	<div class="card">
		<div class="card-head"><span class="card-title">Add a class</span></div>
		<form method="POST" action="?/create" class="inline-form">
			<div class="field">
				<label for="c-name">Name</label>
				<input id="c-name" name="name" type="text" required placeholder="Algebra I" />
			</div>
			<div class="field">
				<label for="c-subject">Subject</label>
				<input id="c-subject" name="subject" type="text" placeholder="Math" />
			</div>
			<div class="field" style="flex:0 1 140px">
				<label for="c-color">Color</label>
				<select id="c-color" name="color">
					{#each data.colors as c}<option value={c}>{c}</option>{/each}
				</select>
			</div>
			<button class="btn btn-primary" type="submit">Add</button>
		</form>
	</div>

	{#if data.allClasses.length}
		<div class="stack-s">
			{#each data.allClasses as k (k.id)}
				<div class="card tagged" style="--tag: var(--c-{k.color}); {k.archived ? 'opacity:.55' : ''}">
					{#if editing === k.id}
						<form method="POST" action="?/update" class="inline-form">
							<input type="hidden" name="id" value={k.id} />
							<div class="field">
								<label for="e-name-{k.id}">Name</label>
								<input id="e-name-{k.id}" name="name" type="text" value={k.name} required />
							</div>
							<div class="field">
								<label for="e-sub-{k.id}">Subject</label>
								<input id="e-sub-{k.id}" name="subject" type="text" value={k.subject ?? ''} />
							</div>
							<div class="field" style="flex:0 1 140px">
								<label for="e-col-{k.id}">Color</label>
								<select id="e-col-{k.id}" name="color">
									{#each data.colors as c}
										<option value={c} selected={c === k.color}>{c}</option>
									{/each}
								</select>
							</div>
							<button class="btn btn-primary btn-sm" type="submit">Save</button>
							<button class="btn btn-ghost btn-sm" type="button" onclick={() => (editing = null)}>
								Cancel
							</button>
						</form>
					{:else}
						<div class="row-between">
							<div>
								<div class="card-title">{k.name}</div>
								<div class="card-note">
									{k.subject ?? 'No subject'}
									{#if k.archived}· <span class="badge">archived</span>{/if}
								</div>
							</div>
							<div class="btn-row">
								<button class="btn btn-sm" onclick={() => (editing = k.id)}>Edit</button>
								<form method="POST" action="?/setArchived">
									<input type="hidden" name="id" value={k.id} />
									<input type="hidden" name="archived" value={String(!k.archived)} />
									<button class="btn btn-sm" type="submit">
										{k.archived ? 'Restore' : 'Archive'}
									</button>
								</form>
							</div>
						</div>

						<div style="margin-top:.85rem">
							<div class="label" style="margin-bottom:.35rem">Students</div>
							{#if data.students.length}
								<Roster
									entries={rosterByClass.get(k.id) ?? []}
									options={studentOptions}
									fixed={{ name: 'class_id', value: k.id }}
									pick="student_id"
									addLabel="Add student"
									emptyLabel="Nobody enrolled — this class shows up for no student."
								/>
							{:else}
								<div class="card-note">
									No students yet. <a href="/admin/students">Add one</a> to build a roster.
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{:else}
		<div class="empty">
			<h3>No classes yet</h3>
			<p>
				Add the subjects you teach. Assignments and weekly goals both hang off a class,
				and a student sees them only once they are on its roster.
			</p>
		</div>
	{/if}
</div>
