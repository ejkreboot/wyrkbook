import { json } from '@sveltejs/kit';
import { clearPages, folderFor, listPages, requireTeacher } from '$lib/server/outlinePages';
import type { RequestHandler } from './$types';

/**
 * The pages already waiting, oldest first. The desktop asks once each time its
 * Realtime channel comes up, to catch anything sent while it was not listening;
 * otherwise it hears about each page as it lands. Uploads arrive through the
 * phone's own route, /phone/[id]/upload.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const teacher = requireTeacher(locals);
	return json({ pages: await listPages(locals, folderFor(teacher, params.resourceId)) });
};

/** The desktop is starting or has stopped listening: nothing here is wanted. */
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const teacher = requireTeacher(locals);
	await clearPages(locals, folderFor(teacher, params.resourceId));
	return new Response(null, { status: 204 });
};
