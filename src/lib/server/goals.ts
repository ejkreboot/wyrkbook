import { fail, type RequestEvent } from '@sveltejs/kit';

/**
 * Weekly-goal mutations. Shared verbatim by the "this week" board and the
 * calendar month view so a goal behaves identically wherever it is edited.
 */
export const goalActions = {
	addGoal: async ({ request, locals }: RequestEvent) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const classId = String(form.get('class_id') ?? '');
		const weekStart = String(form.get('week_start') ?? '');
		const detail = String(form.get('detail') ?? '').trim() || null;

		if (!title || !classId || !weekStart) {
			return fail(400, { message: 'A goal needs a class, a week and a title.' });
		}

		const { data: max } = await locals.supabase
			.from('weekly_goal')
			.select('sort_order')
			.eq('class_id', classId)
			.eq('week_start', weekStart)
			.order('sort_order', { ascending: false })
			.limit(1)
			.maybeSingle();

		const { error } = await locals.supabase.from('weekly_goal').insert({
			org_id: locals.profile!.org_id,
			class_id: classId,
			week_start: weekStart,
			title,
			detail,
			sort_order: (max?.sort_order ?? -1) + 1
		});

		if (error) return fail(400, { message: error.message });
		return { message: 'Goal added.' };
	},

	toggleGoal: async ({ request, locals }: RequestEvent) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const done = String(form.get('done') ?? '') === 'true';
		const { error } = await locals.supabase.from('weekly_goal').update({ done }).eq('id', id);
		if (error) return fail(400, { message: error.message });
		return { ok: true };
	},

	deleteGoal: async ({ request, locals }: RequestEvent) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const { error } = await locals.supabase.from('weekly_goal').delete().eq('id', id);
		if (error) return fail(400, { message: error.message });
		return { message: 'Goal removed.' };
	}
};
