import { error } from '@sveltejs/kit';
import { MODEL } from '$lib/server/anthropic';
import { filesToImageParts } from '$lib/server/vision';
import { importParams, type ImportDocument, type ImportPicture } from '$lib/server/importPrompt';
import { streamOutline } from '$lib/server/outlineStream';
import example from '$lib/server/outline-example.md?raw';
import type { RequestHandler } from './$types';

/** A long unit's handout is tens of thousands of characters; this only stops a runaway. */
const MAX_DOCUMENT = 150_000;
const MAX_INSTRUCTIONS = 2000;
/** WordImport sends at most this many; the rest stay as notes. */
const MAX_PICTURES = 20;

export const config = { maxDuration: 300 };

/**
 * A lecture's Word documents in, the resource's Markdown out, streamed like
 * /api/outline. Multipart:
 *
 *     handout, teacher    JSON { name, text }, either optional
 *     picture             images, each named "<n>.jpg" for its [picture n]
 *     missing             "2,5": pictures the browser couldn't read
 *     instructions, class_name
 *
 * The browser reads the .docx files ($lib/docx) and sends their text and
 * pictures, never the files. Like the textbook photos, the pictures exist only
 * in this request: sent to the API and dropped.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.profile || !['admin', 'sysadmin'].includes(locals.profile.role)) {
		error(403, 'Only teachers can import outlines.');
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		error(400, 'Expected a form upload.');
	}

	const text = (key: string, max: number) => {
		const v = form.get(key) ?? '';
		if (typeof v !== 'string') error(400, `${key} must be text.`);
		if (v.length > max) error(400, `${key} is too long.`);
		return v.trim();
	};

	const document = (key: string): ImportDocument | null => {
		const raw = text(key, MAX_DOCUMENT + 1000);
		if (!raw) return null;
		let d: Record<string, unknown>;
		try {
			d = JSON.parse(raw);
		} catch {
			error(400, `${key} must be a document.`);
		}
		const body = typeof d.text === 'string' ? d.text.trim() : '';
		if (body.length > MAX_DOCUMENT) error(400, `The ${key} is too long to import in one go.`);
		const name = typeof d.name === 'string' ? d.name.slice(0, 200) : '';
		return body ? { name: name || `${key}.docx`, text: body } : null;
	};

	const handout = document('handout');
	const teacher = document('teacher');
	if (!handout && !teacher) error(400, 'There is nothing to import — the documents have no text in them.');

	const files = form.getAll('picture').filter((f): f is File => f instanceof File);
	const numbers = files.map((f) => Number.parseInt(f.name, 10));
	if (numbers.some((n) => !Number.isInteger(n) || n < 1)) error(400, 'Each picture must be named for its number.');
	const parts = files.length ? await filesToImageParts(files, MAX_PICTURES) : [];
	const pictures: ImportPicture[] = parts.map((p, i) => ({
		n: numbers[i],
		media_type: p.media_type as ImportPicture['media_type'],
		data: p.data
	}));
	const missing = text('missing', 500)
		.split(',')
		.map((n) => Number.parseInt(n, 10))
		.filter((n) => Number.isInteger(n) && n > 0);

	return streamOutline(
		importParams({
			model: MODEL,
			example,
			handout,
			teacher,
			pictures,
			missing,
			className: text('class_name', 120),
			instructions: text('instructions', MAX_INSTRUCTIONS)
		}),
		'The AI declined to convert those documents. Check they are the right files and try again.'
	);
};
