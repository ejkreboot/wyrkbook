import { error, json } from '@sveltejs/kit';
import { anthropicClient, imageMessage, MODEL, textOf } from '$lib/server/anthropic';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { filesToImageParts } from '$lib/server/vision';
import type { RequestHandler } from './$types';

const SYSTEM = `You are a patient tutor helping a homeschool student who is stuck on a
problem they are working by hand on paper.

Your job is to get them unstuck, never to hand them the answer.

- Read their handwriting carefully. If they have already made progress, say what
  they have right before anything else — it orients them.
- If you can see a specific mistake (a sign error, a mis-copied number, a step
  applied out of order), point at exactly where it happened. Do not correct it
  for them; show them where to look.
- If they have not started, name the first move and why that move is the one to
  reach for. One step only.
- Never state the final answer, and never work the problem through to the end.
  If the problem is one step from done, confirm their approach and let them
  finish it.
- Write to the student, in second person, at their apparent level. Two or three
  short paragraphs at most. No headings, no bullet lists, no LaTeX.
- If the photo is too blurry or dark to read, say so plainly and ask for another.`;

export const POST: RequestHandler = async ({ request, locals }) => {
	const profile = locals.profile;
	if (!profile) error(401, 'Sign in first.');

	const form = await request.formData();
	const submissionId = String(form.get('submission_id') ?? '');
	const problemId = String(form.get('problem_id') ?? '') || null;
	const question = String(form.get('question') ?? '').trim() || null;
	const files = form.getAll('images').filter((f): f is File => f instanceof File);

	if (!submissionId) error(400, 'Missing submission.');

	// Read through the caller's own client so RLS proves they own this attempt.
	const { data: submission } = await locals.supabase
		.from('submission')
		.select('*, assignment(*)')
		.eq('id', submissionId)
		.maybeSingle();

	if (!submission) error(404, 'That work session was not found.');
	if (submission.student_id !== profile.id) error(403, 'That is not your work.');
	if (submission.status !== 'in_progress') error(409, 'This assignment is already turned in.');

	const assignment = submission.assignment as { id: string; title: string; hint_penalty: number };

	const { data: problems } = await locals.supabase
		.from('problem')
		.select('id, label, body')
		.eq('assignment_id', assignment.id)
		.eq('included', true)
		.order('sort_order');

	const target = problems?.find((p) => p.id === problemId) ?? null;

	/*
	 * The answer is fetched with the service role because the caller is a student
	 * and students have no RLS policy on problem_answer at all. It is used only to
	 * judge whether they are on track — the system prompt forbids revealing it.
	 */
	let targetAnswer: string | null = null;
	if (target) {
		const { data: row } = await supabaseAdmin
			.from('problem_answer')
			.select('answer')
			.eq('problem_id', target.id)
			.maybeSingle();
		targetAnswer = row?.answer ?? null;
	}
	const images = await filesToImageParts(files);

	const context = [
		`Assignment: ${assignment.title}`,
		target
			? `The student says they are working on problem ${target.label}:\n${target.body}`
			: `The student did not say which problem they are on. Work out which one from the photo. The problems in this set are:\n${(problems ?? []).map((p) => `${p.label}. ${p.body}`).join('\n')}`,
		targetAnswer
			? `The correct answer is "${targetAnswer}" — use it to judge whether they are on track, but never reveal it.`
			: '',
		question ? `The student asks: "${question}"` : '',
		'This photo shows their work so far. Give them one hint.'
	]
		.filter(Boolean)
		.join('\n\n');

	const response = await anthropicClient().messages.create({
		model: MODEL,
		max_tokens: 2000,
		system: SYSTEM,
		thinking: { type: 'adaptive' },
		output_config: { effort: 'medium' },
		messages: [imageMessage(images, context)]
	});

	if (response.stop_reason === 'refusal') {
		error(422, 'The AI could not answer that. Try re-taking the photo.');
	}

	const hint = textOf(response.content);
	if (!hint) error(502, 'The AI returned an empty hint. Try again.');

	const penalty = Number(assignment.hint_penalty ?? 0);

	// Written with the service role: students may read their hints but must not be
	// able to forge one, so there is deliberately no student INSERT policy.
	await supabaseAdmin.from('hint_request').insert({
		org_id: profile.org_id,
		submission_id: submissionId,
		problem_id: target?.id ?? null,
		student_id: profile.id,
		question,
		hint,
		penalty
	});

	await supabaseAdmin
		.from('submission')
		.update({ hint_penalty_total: Number(submission.hint_penalty_total ?? 0) + penalty })
		.eq('id', submissionId);

	return json({ hint, penalty, problem_label: target?.label ?? null });
};
