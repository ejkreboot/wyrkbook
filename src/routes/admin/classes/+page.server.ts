import { fail } from '@sveltejs/kit';
import { CLASS_COLORS } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { data } = await locals.supabase
		.from('class')
		.select('*')
		.order('archived')
		.order('name');
	return { allClasses: data ?? [], colors: CLASS_COLORS };
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const subject = String(form.get('subject') ?? '').trim() || null;
		const color = String(form.get('color') ?? 'slate');

		if (!name) return fail(400, { message: 'Give the class a name.' });

		const { error } = await locals.supabase.from('class').insert({
			org_id: locals.profile!.org_id,
			name,
			subject,
			color
		});
		if (error) return fail(400, { message: error.message });
		return { message: `Added ${name}.` };
	},

	update: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const patch = {
			name: String(form.get('name') ?? '').trim(),
			subject: String(form.get('subject') ?? '').trim() || null,
			color: String(form.get('color') ?? 'slate')
		};
		if (!patch.name) return fail(400, { message: 'Give the class a name.' });

		const { error } = await locals.supabase.from('class').update(patch).eq('id', id);
		if (error) return fail(400, { message: error.message });
		return { message: 'Saved.' };
	},

	setArchived: async ({ request, locals }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const archived = String(form.get('archived') ?? '') === 'true';
		const { error } = await locals.supabase.from('class').update({ archived }).eq('id', id);
		if (error) return fail(400, { message: error.message });
		return { message: archived ? 'Archived.' : 'Restored.' };
	}
};
