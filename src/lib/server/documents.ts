import { error } from '@sveltejs/kit';
import type Anthropic from '@anthropic-ai/sdk';

/**
 * Turns one uploaded course document into a content block the Messages API can
 * read. A syllabus arrives as a PDF far more often than as a photo, so this is
 * deliberately wider than `vision.ts`: PDFs go in as `document` blocks, plain
 * text and CSV go in as text, and photos still work for the person who only has
 * a picture of the back of the teacher's manual.
 */

/**
 * Not an Anthropic limit — theirs is 32 MB a request — but a platform one: a
 * Vercel Function's entire request body is capped at 4.5 MB, and that ceiling
 * is enforced at the edge. A larger upload never reaches this code, so the
 * teacher would get a raw 413 instead of a sentence. Cap under it, leaving room
 * for the guidance text and the multipart framing.
 *
 * This is the right cap for the job anyway. A lesson list is tens of kilobytes;
 * a file this size is a textbook, and feeding a whole textbook to a planner is
 * a mistake worth catching early rather than paying for.
 */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

const TEXT_MAX_BYTES = 1024 * 1024;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const TEXT_TYPES = ['text/plain', 'text/csv', 'text/markdown', 'text/tab-separated-values'];

/**
 * Browsers are inconsistent about `File.type` — .md and .csv often arrive as ''
 * or as an Office MIME type — so the extension is the tiebreaker.
 */
function kindOf(file: File): 'pdf' | 'image' | 'text' {
	const type = file.type.toLowerCase();
	const ext = (file.name.split('.').pop() ?? '').toLowerCase();

	if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
	if (IMAGE_TYPES.includes(type as (typeof IMAGE_TYPES)[number])) return 'image';
	if (TEXT_TYPES.includes(type) || ['txt', 'csv', 'tsv', 'md', 'text'].includes(ext)) return 'text';

	error(
		400,
		`${file.name || 'That file'} is ${type || 'an unknown type'}. Use a PDF, a plain-text or CSV file, or a photo (JPEG, PNG, WebP). Word documents need to be exported to PDF first.`
	);
}

export async function fileToContentBlock(file: File): Promise<Anthropic.ContentBlockParam> {
	if (!file.size) error(400, `${file.name || 'That file'} is empty.`);
	if (file.size > UPLOAD_MAX_BYTES) {
		error(
			400,
			`${file.name || 'That file'} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 4 MB — a lesson list or syllabus, not a whole textbook.`
		);
	}
	const kind = kindOf(file);

	if (kind === 'pdf') {
		const buf = Buffer.from(await file.arrayBuffer());
		return {
			type: 'document',
			title: file.name || 'Course document',
			source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') }
		};
	}

	if (kind === 'image') {
		const buf = Buffer.from(await file.arrayBuffer());
		return {
			type: 'image',
			source: {
				type: 'base64',
				media_type: file.type.toLowerCase() as 'image/jpeg' | 'image/png' | 'image/webp',
				data: buf.toString('base64')
			}
		};
	}

	if (file.size > TEXT_MAX_BYTES) error(400, `${file.name} is larger than 1 MB.`);
	const text = (await file.text()).trim();
	if (!text) error(400, `${file.name} has no readable text in it.`);
	return {
		type: 'document',
		title: file.name || 'Course document',
		source: { type: 'text', media_type: 'text/plain', data: text }
	};
}
