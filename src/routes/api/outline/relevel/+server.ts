import { error } from '@sveltejs/kit';
import { MODEL } from '$lib/server/anthropic';
import { relevelParams } from '$lib/server/outlinePrompt';
import { streamOutline } from '$lib/server/outlineStream';
import example from '$lib/server/outline-example.md?raw';
import { isOutlineLevel } from '$lib/outlineLevels';
import type { RequestHandler } from './$types';

/** A chapter's outline is a few thousand characters; this only stops a runaway paste. */
const MAX_OUTLINE = 100_000;
const MAX_INSTRUCTIONS = 2000;

export const config = { maxDuration: 300 };

/**
 * A Guided outline in, the same outline at another level out — text only, so it
 * takes seconds rather than re-reading the pages. Streams like /api/outline.
 *
 *     { guided, current?, level, instructions?, class_name?, addition? }
 *
 * `current` is the outline as it stands in the editor, sent when the teacher has
 * edited it so their changes survive the rewrite. With `addition` (the Guided
 * lines for pages appended later) the reply is only those lines at `level`, to
 * add to the end of `current`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.profile || !['admin', 'sysadmin'].includes(locals.profile.role)) {
		error(403, 'Only teachers can generate outlines.');
	}

	let input: Record<string, unknown>;
	try {
		input = await request.json();
	} catch {
		error(400, 'Expected a JSON body.');
	}

	const text = (key: string, max: number) => {
		const v = input[key] ?? '';
		if (typeof v !== 'string') error(400, `${key} must be text.`);
		if (v.length > max) error(400, `${key} is too long.`);
		return v.trim();
	};

	const guided = text('guided', MAX_OUTLINE);
	const current = text('current', MAX_OUTLINE);
	const addition = text('addition', MAX_OUTLINE);
	const instructions = text('instructions', MAX_INSTRUCTIONS);
	const className = text('class_name', 120);
	const level = input.level;

	if (!guided) error(400, 'There is no Guided outline to work from.');
	if (!isOutlineLevel(level)) error(400, 'Choose a level.');

	return streamOutline(
		relevelParams({ model: MODEL, example, guided, current, level, className, instructions, addition }),
		'The AI declined to rewrite that outline. Try another level, or generate it again from the pages.'
	);
};
