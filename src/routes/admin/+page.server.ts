import { weekStart } from '$lib/week';
import { goalActions } from '$lib/server/goals';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const week = url.searchParams.get('week') ?? weekStart();

	const [{ data: goals }, { data: assignments }, { data: needsGrading }] = await Promise.all([
		locals.supabase
			.from('weekly_goal')
			.select('*')
			.eq('week_start', week)
			.order('sort_order'),
		locals.supabase
			.from('assignment')
			.select('*')
			.eq('week_start', week)
			.order('created_at'),
		locals.supabase
			.from('submission')
			.select('*, assignment(title, class_id), profile:student_id(display_name)')
			.eq('status', 'submitted')
			.order('submitted_at', { ascending: true })
	]);

	return {
		week,
		goals: goals ?? [],
		assignments: assignments ?? [],
		needsGrading: needsGrading ?? []
	};
};

export const actions: Actions = goalActions;
