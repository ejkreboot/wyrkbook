import { error } from '@sveltejs/kit';
import { BUCKET, checkedName, folderFor, requireTeacher } from '$lib/server/outlinePages';
import type { RequestHandler } from './$types';

/**
 * The desktop takes a page in two steps — fetch, then delete — so a photo is
 * only removed from storage once it has safely arrived.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
	const profile = requireTeacher(locals);
	const path = `${folderFor(profile, params.resourceId)}/${checkedName(params.name)}`;

	const { data, error: e } = await locals.supabase.storage.from(BUCKET).download(path);
	if (e || !data) error(404, 'That page is gone.');

	return new Response(data, {
		headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }
	});
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const profile = requireTeacher(locals);
	const path = `${folderFor(profile, params.resourceId)}/${checkedName(params.name)}`;

	const { error: e } = await locals.supabase.storage.from(BUCKET).remove([path]);
	if (e) error(500, e.message);

	return new Response(null, { status: 204 });
};
