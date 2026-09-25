import { error, fail, redirect } from '@sveltejs/kit';
import { addWeeks, weekStart } from '$lib/week';
import { isOutlineLevel } from '$lib/outlineLevels';
import type { CurriculumResource, OutlineSource } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

/** Generous for lecture notes; it only exists so a paste accident cannot store megabytes. */
const MAX_BODY = 200_000;

export const load: PageServerLoad = async ({ locals, params }) => {
	const { data: resource } = await locals.supabase
		.from('curriculum_resource')
		.select('*')
		.eq('id', params.id)
		.maybeSingle();

	if (!resource) error(404, 'Resource not found.');

	// Most of a school year either side of where it sits now, so a resource can be
	// moved to any week of the term without leaving the editor.
	const base = resource.week_start ?? weekStart();
	const weekOptions = Array.from({ length: 53 }, (_, i) => addWeeks(base, i - 12));

	return { resource: resource as CurriculumResource, weekOptions };
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const form = await request.formData();

		const patch = {
			title: String(form.get('title') ?? '').trim(),
			class_id: String(form.get('class_id') ?? ''),
			week_start: String(form.get('week_start') ?? '') || null,
			/*
			 * Not trimmed: leading indentation can be a code block, and the editor
			 * compares what it sent with what comes back to decide it is saved. The
			 * CRLFs are the browser's — form submission turns a textarea's \n into
			 * \r\n — and would otherwise make every save look like an edit.
			 */
			body: String(form.get('body') ?? '').replace(/\r\n?/g, '\n'),
			outline_source: null as OutlineSource | null,
			updated_at: new Date().toISOString()
		};
		patch.outline_source = parseSource(String(form.get('outline_source') ?? ''), patch.body);

		if (!patch.title) return fail(400, { message: 'Give the resource a title.' });
		if (!patch.class_id) return fail(400, { message: 'Choose a class.' });
		if (patch.body.length > MAX_BODY) {
			return fail(400, { message: `That is over ${MAX_BODY.toLocaleString()} characters — split it up.` });
		}

		const { error: e } = await locals.supabase
			.from('curriculum_resource')
			.update(patch)
			.eq('id', params.id);
		if (e) return fail(400, { message: e.message });

		return { message: 'Saved.' };
	},

	remove: async ({ locals, params }) => {
		const { error: e } = await locals.supabase
			.from('curriculum_resource')
			.delete()
			.eq('id', params.id);
		if (e) return fail(400, { message: e.message });
		redirect(303, '/admin/curriculum');
	}
};

/**
 * The editor's record of a generated outline (migration 012). Anything that does
 * not hold together is dropped rather than failing the save: losing it costs the
 * teacher the level switcher, never their writing.
 */
function parseSource(raw: string, body: string): OutlineSource | null {
	if (!raw) return null;
	let o: Record<string, unknown>;
	try {
		o = JSON.parse(raw);
	} catch {
		return null;
	}
	const { guided, level, instructions, start, end, edited } = o ?? {};
	if (typeof guided !== 'string' || !guided.trim() || guided.length > MAX_BODY) return null;
	if (!isOutlineLevel(level) || typeof instructions !== 'string') return null;
	if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
	const s = start as number;
	const e = end as number;
	if (s < 0 || s > e || e > body.length) return null;
	return { guided, level, instructions: instructions.slice(0, 2000), start: s, end: e, edited: edited === true };
}
