import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * The target of the QR code printed on every assignment sheet. Scanning it opens
 * (or resumes) that student's work session, so the app already knows which class
 * and assignment their photos belong to before they take the first one.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const profile = locals.profile;
	if (!profile) redirect(303, `/login?next=${encodeURIComponent(`/s/${params.id}`)}`);

	// Teachers scanning their own sheet land on the editor rather than a session.
	if (profile.role !== 'student') {
		redirect(303, `/admin/assignments/${params.id}`);
	}

	const { data: assignment } = await locals.supabase
		.from('assignment')
		.select('id, status')
		.eq('id', params.id)
		.maybeSingle();

	if (!assignment) {
		error(404, 'That assignment is not available. Check with your teacher.');
	}

	const { data: existing } = await locals.supabase
		.from('submission')
		.select('id, status')
		.eq('assignment_id', assignment.id)
		.eq('student_id', profile.id)
		.order('created_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if (existing?.status === 'in_progress') {
		redirect(303, `/student/a/${assignment.id}`);
	}

	if (!existing) {
		await locals.supabase.from('submission').insert({
			org_id: profile.org_id,
			assignment_id: assignment.id,
			student_id: profile.id
		});
	}

	redirect(303, `/student/a/${assignment.id}`);
};
