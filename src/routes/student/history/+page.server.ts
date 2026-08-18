import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { data } = await locals.supabase
		.from('submission')
		.select('*, assignment(title, class_id)')
		.eq('student_id', locals.profile!.id)
		.eq('status', 'graded')
		.order('graded_at', { ascending: false });

	return { submissions: data ?? [] };
};
