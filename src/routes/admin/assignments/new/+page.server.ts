import { fail, redirect } from '@sveltejs/kit';
import { weekStart } from '$lib/week';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	return {
		presetClass: url.searchParams.get('class') ?? '',
		presetWeek: url.searchParams.get('week') ?? weekStart()
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const classId = String(form.get('class_id') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const instructions = String(form.get('instructions') ?? '').trim() || null;
		const week = String(form.get('week_start') ?? '') || null;
		const hintPenalty = Number(form.get('hint_penalty') ?? 5);
		const workPages = Number(form.get('work_pages') ?? 4);

		let problems: { label: string; body: string }[] = [];
		try {
			problems = JSON.parse(String(form.get('problems') ?? '[]'));
		} catch {
			return fail(400, { message: 'The extracted problems could not be read. Try again.' });
		}

		if (!classId) return fail(400, { message: 'Choose a class.' });
		if (!title) return fail(400, { message: 'Give the assignment a title.' });
		if (!problems.length) return fail(400, { message: 'There are no problems to save.' });

		const orgId = locals.profile!.org_id;

		const { data: assignment, error: aError } = await locals.supabase
			.from('assignment')
			.insert({
				org_id: orgId,
				class_id: classId,
				title,
				instructions,
				week_start: week,
				hint_penalty: Number.isFinite(hintPenalty) ? hintPenalty : 5,
				work_pages: Number.isFinite(workPages) ? Math.min(Math.max(workPages, 0), 20) : 4,
				created_by: locals.profile!.id
			})
			.select()
			.single();

		if (aError || !assignment) return fail(400, { message: aError?.message ?? 'Could not save.' });

		const { error: pError } = await locals.supabase.from('problem').insert(
			problems.map((p, i) => ({
				org_id: orgId,
				assignment_id: assignment.id,
				label: String(p.label ?? i + 1).slice(0, 24),
				body: String(p.body ?? '').trim(),
				sort_order: i
			}))
		);

		if (pError) return fail(400, { message: pError.message });

		redirect(303, `/admin/assignments/${assignment.id}`);
	}
};
