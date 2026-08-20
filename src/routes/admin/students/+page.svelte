<script lang="ts">
	import Roster from '$lib/components/Roster.svelte';

	let { data, form } = $props();

	const students = $derived(data.people.filter((p) => p.role === 'student'));
	const admins = $derived(data.people.filter((p) => p.role === 'admin'));

	const classById = $derived(new Map(data.classes.map((c) => [c.id, c])));

	/** student id -> the classes they are on, in the load's name order. */
	const classesByStudent = $derived.by(() => {
		const m = new Map<string, { id: string; label: string; color: string }[]>();
		for (const p of students) m.set(p.id, []);
		for (const e of data.enrollments) {
			const k = classById.get(e.class_id);
			if (k) m.get(e.student_id)?.push({ id: k.id, label: k.name, color: k.color });
		}
		return m;
	});

	const classOptions = $derived(
		data.classes.filter((c) => !c.archived).map((c) => ({ id: c.id, label: c.name }))
	);
</script>

<div class="wrap stack">
	<h1>People</h1>

	{#if form?.message}
		<div class="alert {form.ok ? 'alert-ok' : 'alert-bad'}">{form.message}</div>
	{/if}

	<div class="card">
		<div class="card-head">
			<span class="card-title">Add someone</span>
			<span class="card-note">They sign in with a code emailed to this address.</span>
		</div>
		<form method="POST" action="?/add" class="inline-form">
			<div class="field">
				<label for="s-name">Name</label>
				<input id="s-name" name="display_name" type="text" required />
			</div>
			<div class="field">
				<label for="s-email">Email</label>
				<input id="s-email" name="email" type="email" required />
			</div>
			<div class="field" style="flex:0 1 150px">
				<label for="s-role">Role</label>
				<select id="s-role" name="role">
					<option value="student">Student</option>
					<option value="admin">Teacher</option>
				</select>
			</div>
			<button class="btn btn-primary" type="submit">Add</button>
		</form>
	</div>

	<div class="card card-flush">
		<div style="padding:1rem 1rem .25rem">
			<span class="card-title">Students</span>
			<span class="card-note"> — a student sees the goals and assignments of their classes.</span>
		</div>
		{#if students.length}
			<ul class="list">
				{#each students as p (p.id)}
					<!-- Roster chips make this row tall; centering the Remove button
					     against them puts it nowhere in particular. -->
					<li style="align-items:flex-start">
						<div class="list-main">
							<div class="list-title">{p.display_name}</div>
							<div class="list-sub mono">{p.email}</div>
							{#if data.classes.length}
								<div style="margin-top:.5rem">
									<Roster
										entries={classesByStudent.get(p.id) ?? []}
										options={classOptions}
										fixed={{ name: 'student_id', value: p.id }}
										pick="class_id"
										addLabel="Add class"
										emptyLabel="No classes — this student sees nothing yet."
									/>
								</div>
							{/if}
						</div>
						<form method="POST" action="?/remove">
							<input type="hidden" name="id" value={p.id} />
							<button class="btn btn-danger btn-sm" type="submit">Remove</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<div class="empty" style="margin:1rem">No students yet.</div>
		{/if}
	</div>

	<div class="card card-flush">
		<div style="padding:1rem 1rem .25rem"><span class="card-title">Teachers</span></div>
		<ul class="list">
			{#each admins as p (p.id)}
				<li>
					<div class="list-main">
						<div class="list-title">{p.display_name}</div>
						<div class="list-sub mono">{p.email}</div>
					</div>
					<form method="POST" action="?/remove">
						<input type="hidden" name="id" value={p.id} />
						<button class="btn btn-danger btn-sm" type="submit">Remove</button>
					</form>
				</li>
			{/each}
		</ul>
	</div>
</div>
