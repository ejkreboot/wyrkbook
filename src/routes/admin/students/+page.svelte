<script lang="ts">
	let { data, form } = $props();

	const students = $derived(data.people.filter((p) => p.role === 'student'));
	const admins = $derived(data.people.filter((p) => p.role === 'admin'));
</script>

<div class="wrap stack">
	<h1>People</h1>

	{#if form?.message}
		<div class="alert {form.message.includes('now sign in') ? 'alert-ok' : 'alert-bad'}">
			{form.message}
		</div>
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
			<span class="card-note"> — any student can work any published assignment.</span>
		</div>
		{#if students.length}
			<ul class="list">
				{#each students as p (p.id)}
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
