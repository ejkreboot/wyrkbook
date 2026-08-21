import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [{ data: classes }, { data: items }, { data: grades }] = await Promise.all([
		locals.supabase.from('class').select('id, name, color'),
		/*
		 * No class filter and no student filter on either of these, on purpose.
		 * `grade_item_student_read` returns only the columns of classes this
		 * student is on — or holds a mark in — and `grade_student_read` only their
		 * own cells. The roster is applied by the database rather than restated
		 * here, the same way the weekly goals on /student are.
		 */
		locals.supabase.from('grade_item').select('*').order('sort_order').order('created_at'),
		locals.supabase.from('grade').select('*')
	]);

	return { classes: classes ?? [], items: items ?? [], grades: grades ?? [] };
};
