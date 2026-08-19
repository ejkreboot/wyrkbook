import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const { data: submission } = await locals.supabase
		.from('submission')
		.select('*, assignment(*), profile:student_id(display_name, email)')
		.eq('id', params.id)
		.maybeSingle();

	if (!submission) error(404, 'Submission not found.');

	const [{ data: results }, { data: pages }, { data: hints }] = await Promise.all([
		locals.supabase
			.from('problem_result')
			.select('*, problem(id, label, body, points, sort_order)')
			.eq('submission_id', params.id),
		locals.supabase
			.from('submission_page')
			.select('*')
			.eq('submission_id', params.id)
			.order('page_number'),
		locals.supabase
			.from('hint_request')
			.select('*')
			.eq('submission_id', params.id)
			.order('created_at')
	]);

	// Signed URLs so the private bucket can be rendered without making it public.
	const pageUrls: string[] = [];
	for (const p of pages ?? []) {
		const { data: signed } = await locals.supabase.storage
			.from('student-work')
			.createSignedUrl(p.storage_path, 60 * 30);
		if (signed?.signedUrl) pageUrls.push(signed.signedUrl);
	}

	const ordered = (results ?? []).sort(
		(a, b) => (a.problem?.sort_order ?? 0) - (b.problem?.sort_order ?? 0)
	);

	// Answers live in an admin-only sidecar; this page is admin-only, so the
	// caller's own client can read it and RLS still does the enforcing.
	const problemIds = ordered.map((r) => r.problem?.id).filter((id): id is string => !!id);
	const { data: answers } = problemIds.length
		? await locals.supabase
				.from('problem_answer')
				.select('problem_id, answer')
				.in('problem_id', problemIds)
		: { data: [] };
	const answerFor = new Map((answers ?? []).map((a) => [a.problem_id, a.answer]));

	const withAnswers = ordered.map((r) => ({
		...r,
		problem: r.problem ? { ...r.problem, answer: answerFor.get(r.problem.id) ?? null } : null
	}));

	return { submission, results: withAnswers, pageUrls, hints: hints ?? [] };
};

export const actions: Actions = {
	/** Teacher override: flip any per-problem verdict and recompute the total. */
	save: async ({ request, locals, params }) => {
		const form = await request.formData();
		const feedback = String(form.get('feedback') ?? '').trim() || null;

		const { data: results } = await locals.supabase
			.from('problem_result')
			.select('id, problem(points)')
			.eq('submission_id', params.id);

		let earned = 0;
		let max = 0;

		for (const r of results ?? []) {
			const points = Number((r.problem as { points?: number } | null)?.points ?? 1);
			const correct = form.get(`correct:${r.id}`) === 'on';
			const gained = correct ? points : 0;
			earned += gained;
			max += points;

			await locals.supabase
				.from('problem_result')
				.update({ correct, points_earned: gained })
				.eq('id', r.id);
		}

		const { data: submission } = await locals.supabase
			.from('submission')
			.select('hint_penalty_total')
			.eq('id', params.id)
			.maybeSingle();

		const rawPercent = max > 0 ? (earned / max) * 100 : 0;
		const finalPercent = Math.max(0, rawPercent - Number(submission?.hint_penalty_total ?? 0));
		const score = Number(((finalPercent / 100) * max).toFixed(2));

		const { error: e } = await locals.supabase
			.from('submission')
			.update({
				score,
				max_score: max,
				feedback,
				status: 'graded',
				graded_at: new Date().toISOString()
			})
			.eq('id', params.id);

		if (e) return fail(400, { message: e.message });
		return { message: 'Grade saved.' };
	}
};
