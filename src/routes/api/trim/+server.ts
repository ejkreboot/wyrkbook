import { error, json } from '@sveltejs/kit';
import { anthropicClient, MODEL, textOf } from '$lib/server/anthropic';
import { parseJSON } from '$lib/server/vision';
import { alignVerdicts, trimParams, type TrimProblem, type TrimResult } from '$lib/server/trimPrompt';
import { isTrimLevel } from '$lib/trimLevels';
import type { RequestHandler } from './$types';

const MAX_PROBLEMS = 200;
const MAX_BODY = 4000;
const MAX_GUIDANCE = 1000;
const MAX_PREVIOUS = 4;

/** Text only, but the model reads every problem closely; typically well under a minute. */
export const config = { maxDuration: 300 };

/**
 * An exercise set in, a verdict per problem out: keep or drop, whether it is
 * review, and a note saying why. Nothing is written — the editor applies the
 * verdicts to its include checkboxes, and the teacher saves as usual.
 *
 * The problems come from the editor rather than the database, so a trim sees
 * the edits on screen and not only what was last saved. The assignment id is
 * read through the caller's own client, which is what proves it is theirs.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.profile || !['admin', 'sysadmin'].includes(locals.profile.role)) {
		error(403, 'Only teachers can trim assignments.');
	}

	const input = await request.json().catch(() => null);
	if (!input || typeof input !== 'object') error(400, 'The request could not be read.');

	const { data: assignment } = await locals.supabase
		.from('assignment')
		.select('title, instructions, class:class_id(name)')
		.eq('id', String(input.assignment_id ?? ''))
		.maybeSingle();
	if (!assignment) error(404, 'Assignment not found.');

	if (!isTrimLevel(input.level)) error(400, 'Pick how hard to trim.');

	const raw: unknown[] = Array.isArray(input.problems) ? input.problems : [];
	if (raw.length > MAX_PROBLEMS) error(400, `Trimming handles up to ${MAX_PROBLEMS} problems at a time.`);
	const problems: TrimProblem[] = raw.map((p, i) => {
		const r = (p ?? {}) as Record<string, unknown>;
		return {
			label: String(r.label ?? i + 1).slice(0, 24),
			section: r.section ? String(r.section).slice(0, 120) : null,
			body: String(r.body ?? '').slice(0, MAX_BODY)
		};
	});
	if (problems.length < 2) error(400, 'There is nothing to trim.');

	const previous: string[][] = (Array.isArray(input.previous) ? input.previous : [])
		.slice(-MAX_PREVIOUS)
		.filter(Array.isArray)
		.map((keys: unknown[]) => keys.map(String).filter((k) => /^\d+$/.test(k) && Number(k) <= problems.length));

	const klass = assignment.class as unknown as { name: string } | null;

	const response = await anthropicClient().messages.create(
		trimParams({
			model: MODEL,
			problems,
			level: input.level,
			title: assignment.title ?? '',
			instructions: assignment.instructions ?? '',
			className: klass?.name ?? '',
			guidance: String(input.guidance ?? '').trim().slice(0, MAX_GUIDANCE),
			previous
		})
	);

	if (response.stop_reason === 'refusal') {
		error(422, 'The AI declined to trim this set. Try again, or trim it by hand.');
	}
	if (response.stop_reason === 'max_tokens') {
		error(502, 'The set is too long to trim in one go. Try again, or split the assignment.');
	}

	const result = parseJSON<Partial<TrimResult>>(textOf(response.content));
	const verdicts = alignVerdicts(problems.length, result);
	if (!verdicts.some((v) => v.keep)) error(502, 'The AI dropped every problem. Try again.');

	return json({ problems: verdicts, summary: String(result.summary ?? '').trim() });
};
