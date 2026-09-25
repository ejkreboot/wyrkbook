import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const classFilter = url.searchParams.get('class') ?? '';

	// Body is left out: the list only needs titles, and a term of lecture notes adds up.
	let q = locals.supabase
		.from('curriculum_resource')
		.select('id, class_id, title, week_start, updated_at')
		.order('week_start', { ascending: true, nullsFirst: true })
		.order('title');

	if (classFilter) q = q.eq('class_id', classFilter);

	const { data } = await q;

	return { resources: data ?? [], classFilter };
};

export const actions: Actions = {
	/** Creates an empty resource and opens it in the editor. */
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const classId = String(form.get('class_id') ?? '');

		if (!title) return fail(400, { message: 'Give the resource a title.' });
		if (!classId) return fail(400, { message: 'Choose a class.' });

		const { data, error } = await locals.supabase
			.from('curriculum_resource')
			.insert({
				org_id: locals.profile!.org_id,
				class_id: classId,
				title,
				created_by: locals.profile!.id
			})
			.select('id')
			.single();

		if (error || !data) return fail(400, { message: error?.message ?? 'Could not create it.' });
		redirect(303, `/admin/curriculum/${data.id}`);
	}
};
