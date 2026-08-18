import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const { data: submission } = await locals.supabase
		.from('submission')
		.select('*, assignment(title, class_id, hint_penalty)')
		.eq('id', params.id)
		.maybeSingle();

	if (!submission) error(404, 'That result was not found.');

	const [{ data: results }, { data: hints }] = await Promise.all([
		locals.supabase
			.from('problem_result')
			.select('*, problem(label, body, points, sort_order)')
			.eq('submission_id', params.id),
		locals.supabase.from('hint_request').select('*').eq('submission_id', params.id)
	]);

	const ordered = (results ?? []).sort(
		(a, b) => (a.problem?.sort_order ?? 0) - (b.problem?.sort_order ?? 0)
	);

	return { submission, results: ordered, hints: hints ?? [] };
};
