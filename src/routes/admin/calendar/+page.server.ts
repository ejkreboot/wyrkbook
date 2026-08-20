import { weeksInMonth, weekStart } from '$lib/week';
import { goalActions } from '$lib/server/goals';
import { classesForStudent } from '$lib/server/enrollment';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const now = new Date();
	const year = Number(url.searchParams.get('y') ?? now.getFullYear());
	const month0 = Number(url.searchParams.get('m') ?? now.getMonth());
	const classFilter = url.searchParams.get('class') ?? '';
	const studentFilter = url.searchParams.get('student') ?? '';

	const weeks = weeksInMonth(year, month0);

	// Null means "every class"; a list (possibly empty) means "this student's".
	const classIds = await classesForStudent(locals.supabase, studentFilter);

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
	if (classIds) {
		goalQuery = goalQuery.in('class_id', classIds);
		assignmentQuery = assignmentQuery.in('class_id', classIds);
	}

	const [{ data: goals }, { data: assignments }, { data: students }] = await Promise.all([
		goalQuery,
		assignmentQuery,
		locals.supabase
			.from('profile')
			.select('id, display_name')
			.eq('role', 'student')
			.order('display_name')
	]);

	return {
		year,
		month0,
		weeks,
		currentWeek: weekStart(),
		classFilter,
		studentFilter,
		classIds,
		students: students ?? [],
		goals: goals ?? [],
		assignments: assignments ?? []
	};
};

export const actions: Actions = goalActions;
