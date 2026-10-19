import { error, json } from '@sveltejs/kit';
import { anthropicClient, MODEL, textOf } from '$lib/server/anthropic';
import { parseJSON } from '$lib/server/vision';
import { WORK_SPACE_GUIDANCE } from '$lib/server/workSpacePrompt';
import { DEFAULT_WORK_LINES, workLines } from '$lib/workSpace';
import type { RequestHandler } from './$types';

const MAX_PROBLEMS = 200;
const MAX_TEXT = 4000;

/** Text only; the model works through each problem in its head. */
export const config = { maxDuration: 300 };

const SCHEMA = {
	type: 'object',
	properties: {
		problems: {
			type: 'array',
			items: {
				type: 'object',
				properties: { key: { type: 'string' }, work_lines: { type: 'integer' } },
				required: ['key', 'work_lines'],
				additionalProperties: false
			}
		}
	},
	required: ['problems'],
	additionalProperties: false
};

/**
 * An exercise set in, the room to leave below each problem out, in lines.
 * Nothing is written — the editor fills in its work-space fields, and the
 * teacher saves as usual. Like /api/trim, the problems come from the editor so
 * the sizing sees the edits on screen, and the assignment id, read through the
 * caller's own client, is what proves the set is theirs.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.profile || !['admin', 'sysadmin'].includes(locals.profile.role)) {
		error(403, 'Only teachers can size work space.');
	}

	const input = await request.json().catch(() => null);
	if (!input || typeof input !== 'object') error(400, 'The request could not be read.');

	const { data: assignment } = await locals.supabase
		.from('assignment')
		.select('title, instructions, class:class_id(name)')
		.eq('id', String(input.assignment_id ?? ''))
		.maybeSingle();
	if (!assignment) error(404, 'Assignment not found.');

	const raw: unknown[] = Array.isArray(input.problems) ? input.problems : [];
	if (!raw.length) error(400, 'There are no problems to size.');
	if (raw.length > MAX_PROBLEMS) error(400, `Sizing handles up to ${MAX_PROBLEMS} problems at a time.`);
	const problems = raw.map((p, i) => {
		const r = (p ?? {}) as Record<string, unknown>;
		return {
			label: String(r.label ?? i + 1).slice(0, 24),
			directions: String(r.directions ?? '').slice(0, MAX_TEXT).trim(),
			body: String(r.body ?? '').slice(0, MAX_TEXT)
		};
	});

	const klass = assignment.class as unknown as { name: string } | null;
	const listing = problems
		.map((p, i) => `<problem key="${i + 1}" label="${p.label}">\n${p.directions ? `Directions: ${p.directions}\n` : ''}${p.body}\n</problem>`)
		.join('\n');

	const response = await anthropicClient().messages.create({
		model: MODEL,
		max_tokens: 16000,
		thinking: { type: 'adaptive' },
		output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
		messages: [
			{
				role: 'user',
				content: [
					`This is a math exercise set, printed with room below each problem for the student to work it.`,
					[
						klass?.name ? `Class: ${klass.name}` : '',
						`Assignment: ${assignment.title ?? ''}`,
						assignment.instructions ? `Instructions for the whole set: ${assignment.instructions}` : ''
					]
						.filter(Boolean)
						.join('\n'),
					listing,
					`For each problem, by its key, give ${WORK_SPACE_GUIDANCE}`,
					`Return one entry for each of the ${problems.length} problems.`
				].join('\n\n')
			}
		]
	});

	if (response.stop_reason === 'refusal') error(422, 'The AI declined to size this set. Set the lines by hand.');
	if (response.stop_reason === 'max_tokens') error(502, 'The set is too long to size in one go. Try again, or split it.');

	const result = parseJSON<{ problems?: { key: string; work_lines: number }[] }>(textOf(response.content));
	const byKey = new Map((result.problems ?? []).map((p) => [String(p.key).trim(), workLines(p.work_lines)]));
	return json({ lines: problems.map((_, i) => byKey.get(String(i + 1)) ?? DEFAULT_WORK_LINES) });
};
