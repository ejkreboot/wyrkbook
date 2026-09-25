import { error, json } from '@sveltejs/kit';
import { openPhoneLink, receivePage } from '$lib/server/outlinePages';
import type { RequestHandler } from './$types';

/** The phone shrinks each photo to about 2000 px first; this only stops a runaway. */
const MAX_BYTES = 8_000_000;

/** One photo from the phone. The link is checked again on every upload. */
export const POST: RequestHandler = async ({ params, request }) => {
	const form = await request.formData();
	const link = await openPhoneLink(params.id, String(form.get('t') ?? ''));

	const file = form.get('image');
	if (!(file instanceof File) || file.type !== 'image/jpeg') error(400, 'Send one JPEG photo.');
	if (file.size > MAX_BYTES) error(413, 'That photo is too large.');

	await receivePage(link, file);
	return json({ ok: true });
};
