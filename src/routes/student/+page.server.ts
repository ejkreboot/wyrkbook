import { weekStart } from '$lib/week';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [{ data: assignments }, { data: submissions }, { data: classes }] = await Promise.all([
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
		locals.supabase.from('class').select('id, name, color')
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
		submissionByAssignment: Object.fromEntries(byAssignment),
		thisWeek: weekStart()
	};
};
