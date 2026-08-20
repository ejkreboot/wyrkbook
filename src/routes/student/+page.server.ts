import { weekStart } from '$lib/week';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const week = weekStart();

	const [
		{ data: assignments },
		{ data: submissions },
		{ data: classes },
		{ data: enrollments },
		{ data: goals }
	] = await Promise.all([
		locals.supabase
			.from('assignment')
			.select('*')
			.eq('status', 'published')
			.order('week_start', { ascending: false, nullsFirst: false }),
		locals.supabase
			.from('submission')
			.select('*')
			.eq('student_id', locals.profile!.id)
			.order('created_at', { ascending: false }),
		locals.supabase.from('class').select('id, name, color'),
		// RLS narrows this to the caller's own rows, so it is their roster.
		locals.supabase.from('enrollment').select('class_id'),
		/*
		 * No class filter here on purpose: `goal_student_read` only returns goals
		 * for classes the student is enrolled in, so the roster is applied by the
		 * database rather than restated in the query.
		 */
		locals.supabase.from('weekly_goal').select('*').eq('week_start', week).order('sort_order')
	]);

	const byAssignment = new Map<string, NonNullable<typeof submissions>[number]>();
	for (const s of submissions ?? []) {
		if (!byAssignment.has(s.assignment_id)) byAssignment.set(s.assignment_id, s);
	}

	// Anything finished lives on the history page; this page is only what's live.
	const open = (assignments ?? []).filter(
		(a) => byAssignment.get(a.id)?.status !== 'graded'
	);

	return {
		assignments: open,
		classes: classes ?? [],
		myClassIds: (enrollments ?? []).map((e) => e.class_id as string),
		goals: goals ?? [],
		submissionByAssignment: Object.fromEntries(byAssignment),
		thisWeek: week
	};
};
