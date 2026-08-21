import { error, json } from '@sveltejs/kit';
import { anthropicClient, imageMessage, MODEL, textOf } from '$lib/server/anthropic';
import { recordAutoGrade } from '$lib/server/gradebook';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import { filesToImageParts, parseJSON } from '$lib/server/vision';
import type { RequestHandler } from './$types';

const SCHEMA = {
	type: 'object',
	properties: {
		results: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					label: { type: 'string' },
					student_work: { type: 'string' },
					correct: { type: 'boolean' },
					attempted: { type: 'boolean' },
					feedback: { type: 'string' }
				},
				required: ['label', 'student_work', 'correct', 'attempted', 'feedback'],
				additionalProperties: false
			}
		},
		overall_feedback: { type: 'string' }
	},
	required: ['results', 'overall_feedback'],
	additionalProperties: false
};

const SYSTEM = `You are grading a homeschool student's handwritten work.

The photos are of ruled pages. Each page has a narrow left margin where the
student writes the number of the problem that the work beside it belongs to.
Use those margin numbers to attribute work to problems. If a margin number is
missing or illegible, infer the problem from the work itself.

For every problem in the assignment, return one result:
- \`label\` must match the assignment's problem label exactly.
- \`student_work\` is your transcription of what they wrote for that problem,
  as plain text. Empty string if they did not attempt it.
- \`attempted\` is false when there is no work for that problem at all.
- \`correct\` is whether the final answer is right. False when unattempted.
- \`feedback\` is one or two sentences addressed to the student. When they are
  right, say briefly what they did well. When they are wrong, name the specific
  step that went wrong — not just "incorrect". Empty string is acceptable for a
  clean correct answer.

Grade the mathematics, not the handwriting or the neatness. If the method is
sound and the final answer is right, it is correct even if the presentation is
messy. If you genuinely cannot read something, say so in the feedback rather
than guessing at a grade.`;

export const POST: RequestHandler = async ({ request, locals }) => {
	const profile = locals.profile;
	if (!profile) error(401, 'Sign in first.');

	const form = await request.formData();
	const submissionId = String(form.get('submission_id') ?? '');
	const files = form.getAll('images').filter((f): f is File => f instanceof File);

	if (!submissionId) error(400, 'Missing submission.');

	const { data: submission } = await locals.supabase
		.from('submission')
		.select('*, assignment(*)')
		.eq('id', submissionId)
		.maybeSingle();

	if (!submission) error(404, 'That work session was not found.');
	if (submission.student_id !== profile.id) error(403, 'That is not your work.');
	if (submission.status !== 'in_progress') error(409, 'This assignment is already turned in.');

	const assignment = submission.assignment as {
		id: string;
		title: string;
		instructions: string | null;
	};

	const { data: problems } = await locals.supabase
		.from('problem')
		.select('id, label, body, points')
		.eq('assignment_id', assignment.id)
		.eq('included', true)
		.order('sort_order');

	if (!problems?.length) error(409, 'This assignment has no problems to grade.');

	/*
	 * Answers and the answer key come from the sidecar tables via the service
	 * role: the caller is the student, and students have no policy on either
	 * (migration 004). They never leave this handler.
	 */
	const [{ data: keyRow }, { data: answerRows }] = await Promise.all([
		supabaseAdmin
			.from('assignment_key')
			.select('answer_key')
			.eq('assignment_id', assignment.id)
			.maybeSingle(),
		supabaseAdmin
			.from('problem_answer')
			.select('problem_id, answer')
			.in('problem_id', problems.map((p) => p.id))
	]);

	const answerKey = keyRow?.answer_key ?? null;
	const answerFor = new Map((answerRows ?? []).map((a) => [a.problem_id, a.answer]));

	const images = await filesToImageParts(files);

	// Keep the photos: the teacher needs to see the original when a grade is disputed.
	const pages: { storage_path: string; page_number: number }[] = [];
	for (const [i, file] of files.entries()) {
		const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
		const path = `${profile.org_id}/${profile.id}/${submissionId}/${i + 1}.${ext}`;
		const { error: uploadError } = await supabaseAdmin.storage
			.from('student-work')
			.upload(path, Buffer.from(await file.arrayBuffer()), {
				contentType: file.type,
				upsert: true
			});
		if (!uploadError) pages.push({ storage_path: path, page_number: i + 1 });
	}

	const context = [
		`Assignment: ${assignment.title}`,
		assignment.instructions ? `Instructions given to the student: ${assignment.instructions}` : '',
		'The problems in this assignment are:',
		problems.map((p) => `${p.label}. ${p.body}`).join('\n'),
		answerKey
			? `The teacher's answer key:\n${answerKey}\nGrade against this key.`
			: answerFor.size
				? `Known answers:\n${problems
						.filter((p) => answerFor.get(p.id))
						.map((p) => `${p.label}. ${answerFor.get(p.id)}`)
						.join('\n')}`
				: 'There is no answer key. Work each problem yourself and grade against your own solution.',
		`The photos are the student's work. Return one result for each of the ${problems.length} problems above.`
	]
		.filter(Boolean)
		.join('\n\n');

	const response = await anthropicClient().messages.create({
		model: MODEL,
		max_tokens: 16000,
		system: SYSTEM,
		thinking: { type: 'adaptive' },
		output_config: {
			effort: 'high',
			format: { type: 'json_schema', schema: SCHEMA }
		},
		messages: [imageMessage(images, context)]
	});

	if (response.stop_reason === 'refusal') {
		error(422, 'The AI declined to grade those images. Try re-shooting the pages.');
	}

	const parsed = parseJSON<{
		results: {
			label: string;
			student_work: string;
			correct: boolean;
			attempted: boolean;
			feedback: string;
		}[];
		overall_feedback: string;
	}>(textOf(response.content));

	const byLabel = new Map(parsed.results.map((r) => [r.label.trim(), r]));

	let earned = 0;
	let max = 0;
	const rows = problems.map((p) => {
		const r = byLabel.get(p.label.trim());
		const points = Number(p.points ?? 1);
		const gained = r?.attempted && r.correct ? points : 0;
		earned += gained;
		max += points;
		return {
			org_id: profile.org_id,
			submission_id: submissionId,
			problem_id: p.id,
			student_work: r?.student_work?.trim() || null,
			correct: r ? r.attempted && r.correct : false,
			points_earned: gained,
			feedback: r?.feedback?.trim() || null
		};
	});

	await supabaseAdmin.from('problem_result').delete().eq('submission_id', submissionId);
	await supabaseAdmin.from('problem_result').insert(rows);

	if (pages.length) {
		await supabaseAdmin.from('submission_page').delete().eq('submission_id', submissionId);
		await supabaseAdmin
			.from('submission_page')
			.insert(pages.map((p) => ({ ...p, org_id: profile.org_id, submission_id: submissionId })));
	}

	// Hints are a percentage penalty on the raw score, floored at zero so a student
	// who asked for a lot of help still keeps credit for what they got right.
	const rawPercent = max > 0 ? (earned / max) * 100 : 0;
	const penalty = Number(submission.hint_penalty_total ?? 0);
	const finalPercent = Math.max(0, rawPercent - penalty);
	const finalScore = (finalPercent / 100) * max;

	await supabaseAdmin
		.from('submission')
		.update({
			status: 'graded',
			score: Number(finalScore.toFixed(2)),
			max_score: max,
			feedback: parsed.overall_feedback ?? null,
			submitted_at: new Date().toISOString(),
			graded_at: new Date().toISOString()
		})
		.eq('id', submissionId);

	/*
	 * Mirror the mark into the gradebook. Service role because the caller is the
	 * student and students have no write policy on `grade` — the same reason
	 * problem_result is written this way.
	 *
	 * The gradebook is a snapshot, not the source of truth, so a failure here
	 * does not take the response down with it: the work is graded either way, and
	 * the teacher can type the cell. Logged rather than swallowed silently.
	 */
	const { error: gradebookError } = await recordAutoGrade(supabaseAdmin, submissionId);
	if (gradebookError) console.error('gradebook sync failed', submissionId, gradebookError);

	return json({
		score: Number(finalScore.toFixed(2)),
		max_score: max,
		raw_percent: Number(rawPercent.toFixed(1)),
		penalty,
		feedback: parsed.overall_feedback ?? ''
	});
};
