import { error } from '@sveltejs/kit';
import { MODEL } from '$lib/server/anthropic';
import { filesToImageParts } from '$lib/server/vision';
import { outlineParams } from '$lib/server/outlinePrompt';
import { streamOutline } from '$lib/server/outlineStream';
import example from '$lib/server/outline-example.md?raw';
import type { RequestHandler } from './$types';

/** A chapter section is rarely more than this, and the pages must fit Vercel's 4.5 MB body. */
const MAX_PAGES = 10;
const MAX_INSTRUCTIONS = 2000;
const MAX_OUTLINE = 100_000;

/** The model call is typically under a minute; the response streams the whole time. */
export const config = { maxDuration: 300 };

/**
 * Textbook photos in, the Guided outline out, streamed (see $lib/server/outlineStream).
 * `continues`, when appending pages, is the Guided outline so far; the reply is
 * then just the lines that carry it on.
 * The editor keeps the Guided outline and derives the teacher's level from it
 * with /api/outline/relevel, so this is the only call that sees the pages.
 *
 * The photos exist only in this request's memory: they are read from the form,
 * sent to the API and dropped. Nothing is written to storage or the database.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.profile || !['admin', 'sysadmin'].includes(locals.profile.role)) {
		error(403, 'Only teachers can generate outlines.');
	}

	const form = await request.formData();
	const files = form.getAll('images').filter((f): f is File => f instanceof File);
	const images = await filesToImageParts(files, MAX_PAGES);

	const className = String(form.get('class_name') ?? '').trim().slice(0, 120);
	const instructions = String(form.get('instructions') ?? '').trim().slice(0, MAX_INSTRUCTIONS);
	const continues = String(form.get('continues') ?? '');
	if (continues.length > MAX_OUTLINE) error(400, 'The outline to continue is too long.');

	return streamOutline(
		outlineParams({ model: MODEL, example, images, className, instructions, continues }),
		'The AI declined to outline those pages. Try re-shooting them, or fewer at a time.'
	);
};
