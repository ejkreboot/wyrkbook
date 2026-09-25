import { error, json } from '@sveltejs/kit';
import {
	BUCKET,
	clearPages,
	folderFor,
	listPages,
	newPageName,
	requireResource,
	requireTeacher
} from '$lib/server/outlinePages';
import type { RequestHandler } from './$types';

/** The phone shrinks each photo to about 2000 px first; this only stops a runaway. */
const MAX_BYTES = 8_000_000;

/**
 * The pages already waiting, oldest first. The desktop asks once when it starts
 * listening, to catch anything sent before its Realtime channel was up; after
 * that it hears about each page as it lands.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const profile = requireTeacher(locals);
	const names = await listPages(locals, folderFor(profile, params.resourceId));
	return json({ pages: names });
};

/** One photo from the phone, stored and then announced to the desktop. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const profile = requireTeacher(locals);
	await requireResource(locals, params.resourceId);

	const form = await request.formData();
	const file = form.get('image');
	if (!(file instanceof File) || file.type !== 'image/jpeg') error(400, 'Send one JPEG photo.');
	if (file.size > MAX_BYTES) error(413, 'That photo is too large.');

	const name = newPageName();
	const path = `${folderFor(profile, params.resourceId)}/${name}`;
	const { error: e } = await locals.supabase.storage
		.from(BUCKET)
		.upload(path, Buffer.from(await file.arrayBuffer()), { contentType: 'image/jpeg' });
	if (e) error(500, e.message);

	// A missed announcement is not fatal: the desktop lists the folder whenever
	// it (re)subscribes, so the page still arrives.
	await locals.supabase.rpc('wb_outline_page_ready', { p_resource: params.resourceId, p_name: name });

	return json({ ok: true });
};

/** The desktop has stopped listening: nothing here is wanted any more. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const profile = requireTeacher(locals);
	await clearPages(locals, folderFor(profile, params.resourceId));
	return new Response(null, { status: 204 });
};
