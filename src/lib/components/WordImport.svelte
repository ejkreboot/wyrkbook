<script lang="ts" module>
	export type ImportRequest = {
		handout: { name: string; text: string } | null;
		teacher: { name: string; text: string } | null;
		instructions: string;
		/** Shrunk for upload; `n` is its [picture n] in the texts. */
		pictures: { n: number; file: File }[];
		/** Pictures that couldn't be sent: an unreadable format, or past MAX_PICTURES. */
		missing: number[];
	};
</script>

<script lang="ts">
	import { mergePictures, readDocx, type DocxText } from '$lib/docx';
	import { shrinkImage, UPLOAD_BUDGET } from '$lib/shrinkImage';

	let {
		onimport,
		onclose
	}: {
		/** The documents read into text; the editor sends them to /api/outline/import and streams the result in. */
		onimport: (request: ImportRequest) => void;
		onclose: () => void;
	} = $props();

	type Slot = 'handout' | 'teacher';
	type Read = DocxText & { name: string };

	let docs = $state<Record<Slot, Read | null>>({ handout: null, teacher: null });
	let instructions = $state('');
	let problem = $state('');
	let dragging = $state<Slot | null>(null);
	let preparing = $state(false);

	/** More than a handout has; past it, a picture becomes a "picture was here" note. */
	const MAX_PICTURES = 20;

	const SLOTS: { id: Slot; label: string; hint: string }[] = [
		{ id: 'handout', label: 'Student handout', hint: 'The copy students fill in' },
		{ id: 'teacher', label: 'Teacher notes', hint: 'Your copy, with the answers' }
	];

	/** A teacher's copy is usually named for it; anything else is taken as the handout. */
	const looksLikeTeacher = (name: string) => /teacher|notes|key|answer|filled|complete/i.test(name);

	async function addFiles(files: File[], slot: Slot) {
		problem = '';
		const word = files.filter((f) => /\.docx$/i.test(f.name));
		if (files.length && !word.length) {
			problem = /\.doc$/i.test(files[0].name)
				? `${files[0].name} is an older Word file (.doc). Open it in Word and save it as .docx, then add that.`
				: `${files[0].name} is not a Word document (.docx).`;
			return;
		}
		if (word.length === 1) return read(word[0], slot);
		// Two dropped together: sort them by name, the other slot taking the rest.
		const [a, b] = word;
		const aTeacher = looksLikeTeacher(a.name) && !looksLikeTeacher(b.name);
		const bTeacher = looksLikeTeacher(b.name) && !looksLikeTeacher(a.name);
		await read(aTeacher ? b : a, 'handout');
		await read(aTeacher ? a : b, 'teacher');
		if (!aTeacher && !bTeacher) problem = 'Check which file is which — the names did not say.';
		if (word.length > 2) problem = 'Only two documents go in at a time, a handout and its teacher notes.';
	}

	async function read(file: File, slot: Slot) {
		try {
			const r = readDocx(new Uint8Array(await file.arrayBuffer()));
			if (!r.text.trim()) throw new Error(`${file.name} has no text in it.`);
			docs[slot] = { ...r, name: file.name };
		} catch (err) {
			problem = (err as Error).message;
		}
	}

	function onPick(e: Event, slot: Slot) {
		const input = e.currentTarget as HTMLInputElement;
		const picked = Array.from(input.files ?? []);
		input.value = '';
		addFiles(picked, slot);
	}

	function onDrop(e: DragEvent, slot: Slot) {
		e.preventDefault();
		dragging = null;
		addFiles(Array.from(e.dataTransfer?.files ?? []), slot);
	}

	function swap() {
		docs = { handout: docs.teacher, teacher: docs.handout };
	}

	const unreadable = $derived(
		(docs.handout?.equationObjects ?? 0) + (docs.teacher?.equationObjects ?? 0)
	);
	const merged = $derived(mergePictures([docs.handout, docs.teacher]));
	const pictures = $derived(merged.pictures.length);
	const undrawable = $derived(merged.pictures.filter((p) => !p.type).length);
	const ready = $derived(!!(docs.handout || docs.teacher));

	/**
	 * Shrinks the pictures to share what is left of the upload budget after the
	 * text, then hands everything to the editor. A picture the browser can't draw
	 * (an old EMF/WMF drawing) is sent as missing, and the AI marks its place.
	 */
	async function start() {
		if (!ready || preparing) return;
		preparing = true;
		problem = '';
		const { texts, pictures: all } = merged;
		const [handoutText, teacherText] = texts;
		const handout = docs.handout && handoutText !== null ? { name: docs.handout.name, text: handoutText } : null;
		const teacher = docs.teacher && teacherText !== null ? { name: docs.teacher.name, text: teacherText } : null;

		const sendable = all.filter((p) => p.type).slice(0, MAX_PICTURES);
		const textBytes = new Blob([handout?.text ?? '', teacher?.text ?? '']).size;
		const each = Math.floor((UPLOAD_BUDGET - textBytes - 50_000) / Math.max(1, sendable.length));
		if (sendable.length && each < 30_000) {
			preparing = false;
			problem = 'These documents are too large to send with their pictures. Split the lecture into two imports.';
			return;
		}
		const sent: ImportRequest['pictures'] = [];
		for (const p of sendable) {
			try {
				const original = new File([p.bytes.slice()], p.name, { type: p.type! });
				sent.push({ n: p.n, file: await shrinkImage(original, { maxEdge: 1600, maxBytes: each, minEdge: 500 }) });
			} catch {
				// Left for `missing`: the AI notes where it was.
			}
		}
		const missing = all.filter((p) => !sent.some((s) => s.n === p.n)).map((p) => p.n);
		preparing = false;
		onimport({ handout, teacher, instructions: instructions.trim(), pictures: sent, missing });
	}

	const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
</script>

<section class="card stack gen-panel" aria-label="Import from Word">
	<div class="row-between">
		<h2 style="margin:0">Import from Word</h2>
		<button class="btn btn-ghost btn-sm" type="button" onclick={onclose}>Close</button>
	</div>
	<p class="muted small" style="margin:0">
		Add the handout and your teacher notes for one lecture — either alone works too. The AI lines
		them up into one outline: the handout's blanks with your answers in them, and anything only in
		your notes as teacher notes. Graphs and number lines in the pictures are redrawn; other
		pictures are described in a note. The files are read on this computer, and only their text and
		pictures go to the AI, which discards them. The result is added below anything already written.
	</p>

	<div class="import-slots">
		{#each SLOTS as s (s.id)}
			{@const d = docs[s.id]}
			<div class="import-slot">
				<label
					class="btn btn-capture"
					class:dragging={dragging === s.id}
					for="import-{s.id}"
					ondragover={(e) => {
						e.preventDefault();
						dragging = s.id;
					}}
					ondragleave={() => (dragging = null)}
					ondrop={(e) => onDrop(e, s.id)}
				>
					<span class="small" style="font-weight:600">{s.label}</span>
					{#if d}
						<span class="import-name">{d.name}</span>
						<span class="hint">{d.text.length.toLocaleString()} characters · click to replace</span>
					{:else}
						<span class="big">📄</span>
						<span class="hint">{s.hint} · drop a .docx or click</span>
					{/if}
				</label>
				<input
					id="import-{s.id}"
					class="sr-only"
					type="file"
					accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
					multiple
					onchange={(e) => onPick(e, s.id)}
				/>
				{#if d}
					<button class="btn btn-ghost btn-sm" type="button" onclick={() => (docs[s.id] = null)}>Remove</button>
				{/if}
			</div>
		{/each}
	</div>

	{#if docs.handout && docs.teacher}
		<div>
			<button class="btn btn-ghost btn-sm" type="button" onclick={swap}>⇄ Swap handout and teacher notes</button>
		</div>
	{/if}

	{#if unreadable}
		<div class="alert alert-warn small" role="status">
			{plural(unreadable, 'equation is', 'equations are')} stored as pictures (MathType or Word's old
			equation editor) and can't be read. Each becomes a teacher note marking where to retype it.
		</div>
	{/if}
	{#if pictures}
		<span class="muted small">
			{plural(pictures, 'picture')} will be sent to the AI to read{undrawable
				? ` — ${undrawable} in an old Word drawing format can't be, and will be marked with a note`
				: ''}{pictures - undrawable > MAX_PICTURES
				? `; only the first ${MAX_PICTURES} are sent, the rest marked with a note`
				: ''}.
		</span>
	{/if}

	<label class="stack" style="gap:.3rem">
		<span class="small" style="font-weight:600">Anything to add <span class="muted">(optional)</span></span>
		<textarea
			rows="2"
			bind:value={instructions}
			maxlength="2000"
			placeholder="e.g. The answers are the red text. Leave out the homework list at the end."
		></textarea>
	</label>

	{#if problem}
		<div class="alert alert-bad" role="alert">{problem}</div>
	{/if}

	<div class="row" style="gap:.6rem;align-items:center">
		<button class="btn btn-primary" type="button" onclick={start} disabled={!ready || preparing}>
			{docs.handout && docs.teacher ? 'Import both' : 'Import'}
		</button>
		{#if preparing}
			<span class="muted small" role="status"><span class="spinner"></span> Preparing pictures…</span>
		{/if}
	</div>
</section>
