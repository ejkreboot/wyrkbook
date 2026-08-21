<script lang="ts">
	import {
		cellKey,
		courseTotal,
		gradeFingerprint,
		readCell,
		splitCellKey,
		writeCell,
		type CellMap
	} from '$lib/gradeGrid';

	let { data, form } = $props();

	const klass = $derived(data.classes.find((c) => c.id === data.classId));

	/** What the boxes say now, and what the server last sent, keyed the same way. */
	let cells = $state<CellMap>({});
	let served = $state<CellMap>({});
	let baseline = $state('');
	let seeded = $state('');

	/*
	 * Re-seed the boxes from the server only when the server actually sent
	 * something different — the same guard the planner uses, so a save's reload
	 * does not fight a teacher who has started typing again.
	 */
	$effect(() => {
		const stamp = `${data.classId}:${data.items.length}:${data.students.length}:${data.grades.length}:${data.grades.map((g) => g.updated_at).join()}`;
		if (stamp === seeded) return;
		seeded = stamp;

		const next: CellMap = {};
		for (const item of data.items) {
			for (const student of data.students) next[cellKey(item.id, student.id)] = '';
		}
		for (const g of data.grades) {
			next[cellKey(g.grade_item_id, g.student_id)] = writeCell(g.points_earned);
		}

		cells = next;
		served = { ...next };
		baseline = gradeFingerprint(next);
	});

	const dirty = $derived(seeded !== '' && gradeFingerprint(cells) !== baseline);
	const invalid = $derived(Object.values(cells).some((v) => readCell(v) === 'invalid'));

	/*
	 * Only the cells that actually moved. Not an optimization: posting every cell
	 * as source='manual' would freeze the whole grid against the auto grader on
	 * the first save.
	 */
	const changed = $derived(
		Object.keys(cells)
			.filter((k) => readCell(cells[k]) !== readCell(served[k] ?? ''))
			.map((k) => {
				const { itemId, studentId } = splitCellKey(k);
				return { item_id: itemId, student_id: studentId, value: cells[k] };
			})
	);

	/** Which cells the grader wrote, so the teacher can see what is still live. */
	const autoCells = $derived(
		new Set(
			data.grades
				.filter((g) => g.source === 'auto')
				.map((g) => cellKey(g.grade_item_id, g.student_id))
		)
	);

	function totalFor(studentId: string) {
		return courseTotal(data.items, (itemId) => {
			const v = readCell(cells[cellKey(itemId, studentId)] ?? '');
			return v === 'invalid' ? null : v;
		});
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			// requestSubmit() ignores a disabled button, so the guard belongs here too.
			if (!dirty || invalid) return;
			(e.currentTarget as HTMLElement).closest('form')?.requestSubmit();
		}
	}

	let adding = $state(false);
	let linkTo = $state('');

	// Linking to an assignment names the column for you; typing one does not.
	const linked = $derived(data.linkable.find((a) => a.id === linkTo));
</script>

<div class="wrap stack" style="padding-block:1.25rem">
	<div class="row-between">
		<div>
			<h1>Gradebook</h1>
			<p class="muted small" style="margin:0">
				One column per thing worth points, whether this app graded it or not.
			</p>
		</div>
	</div>

	<!-- Class lives in the URL so a gradebook view is linkable and reloadable. -->
	<form method="GET" class="card row" style="gap:.75rem">
		<div class="field" style="flex:1 1 220px;margin:0">
			<label for="cls">Class</label>
			<select id="cls" name="class" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
				{#each data.classes as c (c.id)}
					<option value={c.id} selected={c.id === data.classId}>{c.name}</option>
				{/each}
			</select>
		</div>
		<noscript><button class="btn btn-sm" type="submit">Go</button></noscript>
	</form>

	{#if form?.message}
		<div class="alert {form.ok ? 'alert-ok' : 'alert-bad'}">{form.message}</div>
	{/if}

	{#if !data.classId}
		<div class="empty">
			<h3>No classes yet</h3>
			<p class="muted">Make a class first and its gradebook appears here.</p>
			<a class="btn btn-sm" href="/admin/classes">Classes</a>
		</div>
	{:else if !data.students.length}
		<div class="empty">
			<h3>Nobody on this roster</h3>
			<p class="muted">A gradebook needs students. Add some to {klass?.name} and come back.</p>
			<a class="btn btn-sm" href="/admin/classes">Manage roster</a>
		</div>
	{:else}
		<form method="POST" action="?class={data.classId}&/saveGrades">
			<input type="hidden" name="class_id" value={data.classId} />
			<input type="hidden" name="cells" value={JSON.stringify(changed)} />

			<div class="save-bar is-sticky">
				<span class="chip" style="--tag: var(--c-{klass?.color ?? 'slate'})">
					<span class="chip-dot"></span>{klass?.name}
				</span>
				<span class="muted small">
					{data.items.length}
					{data.items.length === 1 ? 'item' : 'items'} · {data.students.length}
					{data.students.length === 1 ? 'student' : 'students'}
				</span>
				<div class="spacer"></div>
				{#if invalid}
					<span class="unsaved" role="status" style="color:var(--bad)">
						<span class="unsaved-dot" style="background:var(--bad)"></span>Check the red boxes
					</span>
				{:else if dirty}
					<span class="unsaved" role="status"><span class="unsaved-dot"></span>Unsaved changes</span>
				{/if}
				<button class="btn btn-primary btn-sm" type="submit" disabled={!dirty || invalid}>
					Save grades
				</button>
			</div>

			{#if data.items.length}
				<div class="gb-scroll">
					<table class="gb">
						<thead>
							<tr>
								<th class="gb-name" scope="col">Student</th>
								{#each data.items as item (item.id)}
									<th scope="col">
										{item.title}
										<span class="gb-points">out of {item.points_possible}</span>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each data.students as student (student.id)}
								{@const total = totalFor(student.id)}
								<tr>
									<th class="gb-name" scope="row">
										{student.display_name}
										{#if total}
											<span class="gb-total">
												{total.percent}% · {total.earned}/{total.possible}
											</span>
										{:else}
											<span class="gb-total is-none">no marks yet</span>
										{/if}
										{#if !student.enrolled}
											<span class="gb-former">no longer on the roster</span>
										{/if}
									</th>
									{#each data.items as item (item.id)}
										{@const key = cellKey(item.id, student.id)}
										{@const bad = readCell(cells[key] ?? '') === 'invalid'}
										<td
											class="gb-cell {bad ? 'is-bad' : ''} {readCell(cells[key] ?? '') !==
											readCell(served[key] ?? '')
												? 'is-dirty'
												: ''}"
										>
											{#if autoCells.has(key)}
												<span class="gb-auto" title="Graded by the app"></span>
											{/if}
											<input
												type="text"
												inputmode="decimal"
												enterkeyhint="next"
												bind:value={cells[key]}
												onkeydown={onKeydown}
												aria-invalid={bad}
												aria-label="{student.display_name} — {item.title}"
											/>
										</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p class="muted small" style="margin:.6rem 0 0">
					A blank box is work nobody has marked, and it stays out of the total — type a
					<strong>0</strong> to count it against them. A green dot is a mark the app made; typing
					over one makes it yours and the app will not touch it again. ⌘/Ctrl + Enter saves.
				</p>
			{:else}
				<div class="empty">
					<h3>Nothing worth points yet</h3>
					<p class="muted">Add an item below and the grid appears.</p>
				</div>
			{/if}
		</form>

		<!-- Item admin sits outside the grid's form: these reload the page, and a
		     nested form is not valid HTML anyway. -->
		<div class="card">
			<div class="card-head">
				<span class="card-title">Items</span>
				<button
					class="btn btn-sm"
					type="button"
					onclick={() => (adding = !adding)}
					disabled={dirty}
					title={dirty ? 'Save your grades first' : undefined}
				>
					{adding ? 'Cancel' : '+ Add item'}
				</button>
			</div>

			{#if adding}
				<form method="POST" action="?class={data.classId}&/addItem" class="inline-form">
					<input type="hidden" name="class_id" value={data.classId} />
					<div class="field" style="flex:1 1 200px">
						<label for="new-title">Name</label>
						<input
							id="new-title"
							name="title"
							placeholder={linked ? linked.title : 'Spelling quiz'}
						/>
					</div>
					<div class="field" style="flex:0 1 120px">
						<label for="new-points">Out of</label>
						<input id="new-points" name="points_possible" inputmode="decimal" value="10" />
					</div>
					<div class="field" style="flex:1 1 200px">
						<label for="new-link">Assignment</label>
						<select id="new-link" name="assignment_id" bind:value={linkTo}>
							<option value="">None — I set this outside the app</option>
							{#each data.linkable as a (a.id)}
								<option value={a.id}>{a.title}</option>
							{/each}
						</select>
					</div>
					<button class="btn btn-primary btn-sm" type="submit">Add</button>
				</form>
				<p class="hint" style="margin-top:.5rem">
					Link an assignment and the app fills this column in as work is turned in. Leave it unset
					for anything you graded yourself.
				</p>
			{/if}

			{#if data.items.length}
				<ul class="list" style="margin-top:.5rem">
					{#each data.items as item (item.id)}
						<li>
							<form
								method="POST"
								action="?class={data.classId}&/updateItem"
								class="list-main inline-form"
							>
								<input type="hidden" name="id" value={item.id} />
								<div class="field" style="flex:1 1 180px">
									<input name="title" value={item.title} aria-label="Item name" />
								</div>
								<div class="field" style="flex:0 1 100px">
									<input
										name="points_possible"
										inputmode="decimal"
										value={item.points_possible}
										aria-label="Points possible"
									/>
								</div>
								<button class="btn btn-sm" type="submit" disabled={dirty}>Save</button>
							</form>
							{#if item.assignment_id}
								<a class="btn btn-ghost btn-sm" href="/admin/assignments/{item.assignment_id}">
									Assignment
								</a>
							{/if}
							<form
								method="POST"
								action="?class={data.classId}&/removeItem"
								onsubmit={(e) => {
									if (!confirm(`Delete "${item.title}" and every mark under it?`))
										e.preventDefault();
								}}
							>
								<input type="hidden" name="id" value={item.id} />
								<button class="btn btn-ghost btn-sm gb-item-x" type="submit" disabled={dirty}>
									Delete
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
