<script lang="ts">
	let { data, form } = $props();

	const orgName = $derived((id: string | null) =>
		data.orgs.find((o) => o.id === id)?.name ?? '—'
	);
</script>

<div class="wrap stack">
	<h1>Organizations</h1>

	{#if form?.message}
		<div class="alert alert-ok">{form.message}</div>
	{/if}

	<div class="grid grid-2">
		<div class="card">
			<div class="card-head"><span class="card-title">New organization</span></div>
			<form method="POST" action="?/createOrg" class="inline-form">
				<div class="field">
					<label for="org-name">Name</label>
					<input id="org-name" name="name" type="text" required placeholder="Kort Family School" />
				</div>
				<button class="btn btn-primary" type="submit">Create</button>
			</form>

			{#if data.orgs.length}
				<ul class="list" style="margin-top:1rem">
					{#each data.orgs as org (org.id)}
						<li style="padding-left:0;padding-right:0">
							<div class="list-main">
								<div class="list-title">{org.name}</div>
								<div class="list-sub mono">{org.id}</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="card">
			<div class="card-head"><span class="card-title">New admin</span></div>
			<form method="POST" action="?/createAdmin">
				<div class="field">
					<label for="a-name">Name</label>
					<input id="a-name" name="display_name" type="text" required />
				</div>
				<div class="field">
					<label for="a-email">Email</label>
					<input id="a-email" name="email" type="email" required />
				</div>
				<div class="field">
					<label for="a-org">Organization</label>
					<select id="a-org" name="org_id" required>
						<option value="">Choose…</option>
						{#each data.orgs as org (org.id)}
							<option value={org.id}>{org.name}</option>
						{/each}
					</select>
				</div>
				<button class="btn btn-primary btn-block" type="submit" disabled={!data.orgs.length}>
					Add admin
				</button>
				{#if !data.orgs.length}
					<p class="hint" style="margin-top:.5rem">Create an organization first.</p>
				{/if}
			</form>
		</div>
	</div>

	<div class="card card-flush">
		<div style="padding:1rem 1rem .25rem"><span class="card-title">Everyone</span></div>
		{#if data.people.length}
			<table class="responsive">
				<thead>
					<tr><th>Name</th><th>Email</th><th>Role</th><th>Organization</th><th></th></tr>
				</thead>
				<tbody>
					{#each data.people as p (p.id)}
						<tr>
							<td data-label="Name">{p.display_name}</td>
							<td data-label="Email" class="mono">{p.email}</td>
							<td data-label="Role"><span class="badge">{p.role}</span></td>
							<td data-label="Organization">{orgName(p.org_id)}</td>
							<td data-label="">
								<form method="POST" action="?/deletePerson">
									<input type="hidden" name="id" value={p.id} />
									<button class="btn btn-danger btn-sm" type="submit">Remove</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else}
			<div class="empty" style="margin:1rem">No admins or students yet.</div>
		{/if}
	</div>
</div>
