import { error, fail, redirect } from '@sveltejs/kit';
import { addWeeks, weekStart } from '$lib/week';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const { data: assignment } = await locals.supabase
		.from('assignment')
		.select('*')
		.eq('id', params.id)
		.maybeSingle();

	if (!assignment) error(404, 'Assignment not found.');

	const [{ data: problems }, { data: submissions }] = await Promise.all([
		locals.supabase.from('problem').select('*').eq('assignment_id', params.id).order('sort_order'),
		locals.supabase
			.from('submission')
			.select('*, profile:student_id(display_name)')
			.eq('assignment_id', params.id)
			.order('created_at', { ascending: false })
	]);

	const base = assignment.week_start ?? weekStart();
	const weekOptions = Array.from({ length: 11 }, (_, i) => addWeeks(base, i - 4));

	return {
		assignment,
		problems: problems ?? [],
		submissions: submissions ?? [],
		weekOptions
	};
};

export const actions: Actions = {
	/** Saves the assignment's fields and every problem in one pass. */
	save: async ({ request, locals, params }) => {
		const form = await request.formData();

		const patch = {
			title: String(form.get('title') ?? '').trim(),
			instructions: String(form.get('instructions') ?? '').trim() || null,
			class_id: String(form.get('class_id') ?? ''),
			week_start: String(form.get('week_start') ?? '') || null,
			answer_key: String(form.get('answer_key') ?? '').trim() || null,
			hint_penalty: Number(form.get('hint_penalty') ?? 5),
			work_pages: Math.min(Math.max(Number(form.get('work_pages') ?? 4), 0), 20)
		};

		if (!patch.title) return fail(400, { message: 'Give the assignment a title.' });
		if (!patch.class_id) return fail(400, { message: 'Choose a class.' });

		const { error: aError } = await locals.supabase
			.from('assignment')
			.update(patch)
			.eq('id', params.id);
		if (aError) return fail(400, { message: aError.message });

		let problems: {
			id: string;
			label: string;
			body: string;
			answer: string | null;
			points: number;
			included: boolean;
		}[] = [];
		try {
			problems = JSON.parse(String(form.get('problems') ?? '[]'));
		} catch {
			return fail(400, { message: 'The problem list could not be read.' });
		}

		const keptIds = problems.filter((p) => p.id).map((p) => p.id);
		let deleteQuery = locals.supabase.from('problem').delete().eq('assignment_id', params.id);
		if (keptIds.length) deleteQuery = deleteQuery.not('id', 'in', `(${keptIds.join(',')})`);
		await deleteQuery;

		for (const [i, p] of problems.entries()) {
			const row = {
				org_id: locals.profile!.org_id,
				assignment_id: params.id,
				label: String(p.label ?? i + 1).slice(0, 24),
				body: String(p.body ?? '').trim(),
				answer: p.answer?.trim() || null,
				points: Number.isFinite(Number(p.points)) ? Number(p.points) : 1,
				included: p.included !== false,
				sort_order: i
			};
			if (p.id) {
				await locals.supabase.from('problem').update(row).eq('id', p.id);
			} else {
				await locals.supabase.from('problem').insert(row);
			}
		}

		return { message: 'Saved.' };
	},

	setStatus: async ({ request, locals, params }) => {
		const form = await request.formData();
		const status = String(form.get('status') ?? '');
		if (!['draft', 'published', 'archived'].includes(status)) {
			return fail(400, { message: 'Unknown status.' });
		}

		if (status === 'published') {
			const { count } = await locals.supabase
				.from('problem')
				.select('id', { count: 'exact', head: true })
				.eq('assignment_id', params.id)
				.eq('included', true);
			if (!count) {
				return fail(400, { message: 'Keep at least one problem before publishing.' });
			}
		}

		const { error: e } = await locals.supabase
			.from('assignment')
			.update({ status })
			.eq('id', params.id);
		if (e) return fail(400, { message: e.message });

		return {
			message:
				status === 'published'
					? 'Published — students can see it now.'
					: `Moved back to ${status}.`
		};
	},

	remove: async ({ locals, params }) => {
		const { error: e } = await locals.supabase.from('assignment').delete().eq('id', params.id);
		if (e) return fail(400, { message: e.message });
		redirect(303, '/admin/assignments');
	}
};
