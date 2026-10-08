import { error, json } from '@sveltejs/kit';
import { anthropicClient, imageMessage, MODEL, textOf } from '$lib/server/anthropic';
import { filesToImageParts, parseJSON } from '$lib/server/vision';
import type { RequestHandler } from './$types';

const SCHEMA = {
	type: 'object',
	properties: {
		title: { type: 'string' },
		instructions: { type: 'string' },
		problems: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					label: { type: 'string' },
					section: { type: 'string' },
					body: { type: 'string' }
				},
				required: ['label', 'section', 'body'],
				additionalProperties: false
			}
		}
	},
	required: ['title', 'instructions', 'problems'],
	additionalProperties: false
};

const PROMPT = `These photos are of an exercise set in a textbook.

Transcribe every numbered exercise into structured form.

- \`label\` is the exercise number exactly as printed ("12", "3-4", "7a").
- \`section\` is the heading the exercise is printed under, exactly as printed
  ("Practice", "Mixed Review", "Applications"), or an empty string if the set
  has no headings. Every exercise under one heading gets the same \`section\`.
  A review block matters most: always record it, even when it is set off only by
  a rule or a box with a short title.
- \`body\` is the full text of the exercise, self-contained enough that a student
  could work it without the book open. Keep sub-parts (a), (b), (c) inside the
  one body, on separate lines. If the book prints an earlier lesson's number
  beside the exercise (as Saxon does, in parentheses), begin the body with it:
  "(Lesson 45) ".
- Write all mathematics in KaTeX: \`$...$\` inline, \`$$...$$\` on a line of its
  own for a displayed equation. That covers every variable, expression, equation
  and unit with an exponent: \`Solve $3x + 5 = 20$ for $x$.\`,
  \`Simplify $\\frac{x^2 - 9}{x + 3}$.\` Ordinary numbers and money in prose stay
  as they are, and a literal dollar sign is written \`\\$\`.
- Otherwise the body is plain text: no Markdown, no bold, no bullet characters.
- If a shared instruction line governs a run of exercises ("Solve for x."), put it
  in \`instructions\` rather than repeating it into every body.
- If an exercise depends on a figure, diagram or table you cannot reproduce as
  text, still include it and end the body with "[refer to the diagram in the book]".
- Skip worked examples, page numbers and answer keys. Headings go in \`section\`
  only, never in a body.
- \`title\` is a short name for the set, e.g. "Section 4.2 — Exercises 1-20".

Transcribe what is printed. Do not solve the problems, and do not invent exercises
that are not visible in the photos.`;

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.profile || !['admin', 'sysadmin'].includes(locals.profile.role)) {
		error(403, 'Only teachers can extract assignments.');
	}

	const form = await request.formData();
	const files = form.getAll('images').filter((f): f is File => f instanceof File);
	const images = await filesToImageParts(files);

	const response = await anthropicClient().messages.create({
		model: MODEL,
		max_tokens: 16000,
		thinking: { type: 'adaptive' },
		output_config: {
			effort: 'high',
			format: { type: 'json_schema', schema: SCHEMA }
		},
		messages: [imageMessage(images, PROMPT)]
	});

	if (response.stop_reason === 'refusal') {
		error(422, 'The AI declined to read those images. Try re-shooting the page.');
	}

	const parsed = parseJSON<{
		title: string;
		instructions: string;
		problems: { label: string; section: string; body: string }[];
	}>(textOf(response.content));

	return json({
		title: parsed.title ?? '',
		instructions: parsed.instructions ?? '',
		problems: (parsed.problems ?? []).map((p, i) => ({
			label: String(p.label ?? i + 1),
			section: String(p.section ?? '').trim(),
			body: String(p.body ?? '').trim(),
			sort_order: i
		}))
	});
};
