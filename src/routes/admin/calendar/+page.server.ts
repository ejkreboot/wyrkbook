import { weeksInMonth, weekStart } from '$lib/week';
import { goalActions } from '$lib/server/goals';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const now = new Date();
	const year = Number(url.searchParams.get('y') ?? now.getFullYear());
	const month0 = Number(url.searchParams.get('m') ?? now.getMonth());
	const classFilter = url.searchParams.get('class') ?? '';

	const weeks = weeksInMonth(year, month0);

	let goalQuery = locals.supabase
		.from('weekly_goal')
		.select('*')
		.gte('week_start', weeks[0])
		.lte('week_start', weeks[weeks.length - 1])
		.order('sort_order');

	let assignmentQuery = locals.supabase
		.from('assignment')
		.select('id, title, class_id, week_start, status')
		.gte('week_start', weeks[0])
		.lte('week_start', weeks[weeks.length - 1]);

	if (classFilter) {
		goalQuery = goalQuery.eq('class_id', classFilter);
		assignmentQuery = assignmentQuery.eq('class_id', classFilter);
	}

	const [{ data: goals }, { data: assignments }] = await Promise.all([goalQuery, assignmentQuery]);

	return {
		year,
		month0,
		weeks,
		currentWeek: weekStart(),
		classFilter,
		goals: goals ?? [],
		assignments: assignments ?? []
	};
};

export const actions: Actions = goalActions;
