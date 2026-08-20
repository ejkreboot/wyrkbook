import { weekStart } from '$lib/week';
import { goalActions } from '$lib/server/goals';
import { classesForStudent } from '$lib/server/enrollment';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const week = url.searchParams.get('week') ?? weekStart();
	const studentFilter = url.searchParams.get('student') ?? '';

	// Null means "every class"; a list (possibly empty) means "this student's".
	const classIds = await classesForStudent(locals.supabase, studentFilter);

	let goalQuery = locals.supabase
		.from('weekly_goal')
		.select('*')
		.eq('week_start', week)
		.order('sort_order');

	let assignmentQuery = locals.supabase
		.from('assignment')
		.select('*')
		.eq('week_start', week)
		.order('created_at');

	let gradingQuery = locals.supabase
		.from('submission')
		.select('*, assignment(title, class_id), profile:student_id(display_name)')
		.eq('status', 'submitted')
		.order('submitted_at', { ascending: true });

	if (classIds) {
		goalQuery = goalQuery.in('class_id', classIds);
		assignmentQuery = assignmentQuery.in('class_id', classIds);
		// Filtering by a student means their work, not their classes' work.
		gradingQuery = gradingQuery.eq('student_id', studentFilter);
	}

	const [{ data: goals }, { data: assignments }, { data: needsGrading }, { data: students }] =
		await Promise.all([
			goalQuery,
			assignmentQuery,
			gradingQuery,
			locals.supabase
				.from('profile')
				.select('id, display_name')
				.eq('role', 'student')
				.order('display_name')
		]);

	return {
		week,
		studentFilter,
		classIds,
		students: students ?? [],
		goals: goals ?? [],
		assignments: assignments ?? [],
		needsGrading: needsGrading ?? []
	};
};

export const actions: Actions = goalActions;
