import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const profile = locals.profile!;

	const { data: assignment } = await locals.supabase
		.from('assignment')
		.select('*')
		.eq('id', params.id)
		.maybeSingle();

	if (!assignment) error(404, 'That assignment is not available.');

	const { data: klass } = await locals.supabase
		.from('class')
		.select('name, color')
		.eq('id', assignment.class_id)
		.maybeSingle();

	const { data: problems } = await locals.supabase
		.from('problem')
		.select('id, label, body, points')
		.eq('assignment_id', assignment.id)
		.eq('included', true)
		.order('sort_order');

	let { data: submission } = await locals.supabase
		.from('submission')
		.select('*')
		.eq('assignment_id', assignment.id)
		.eq('student_id', profile.id)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	// Arriving by link rather than by QR: open the session on the spot.
	if (!submission) {
		const { data: created } = await locals.supabase
			.from('submission')
			.insert({ org_id: profile.org_id, assignment_id: assignment.id, student_id: profile.id })
			.select()
			.single();
		submission = created;
	}

	if (submission?.status === 'graded') {
		redirect(303, `/student/result/${submission.id}`);
	}

	const { data: hints } = await locals.supabase
		.from('hint_request')
		.select('*')
		.eq('submission_id', submission!.id)
		.order('created_at', { ascending: false });

	return {
		assignment,
		className: klass?.name ?? '',
		classColor: klass?.color ?? 'slate',
		problems: problems ?? [],
		submission: submission!,
		hints: hints ?? []
	};
};
