import { error, json } from '@sveltejs/kit';
import { phoneLinkFor, requireTeacher } from '$lib/server/outlinePages';
import type { RequestHandler } from './$types';

/**
 * A freshly signed phone link for this resource, as a QR, plus the channel its
 * uploads are announced on. The desktop asks again before the old one expires.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const teacher = requireTeacher(locals);

	// Visible to this teacher under RLS, or no link.
	const { data: resource } = await locals.supabase
		.from('curriculum_resource')
		.select('id')
		.eq('id', params.resourceId)
		.maybeSingle();
	if (!resource) error(404, 'Resource not found.');

	return json(await phoneLinkFor(teacher, resource.id, url.origin), {
		headers: { 'cache-control': 'no-store' }
	});
};
