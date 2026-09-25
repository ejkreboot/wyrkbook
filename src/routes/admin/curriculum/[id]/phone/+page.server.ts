import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Where the QR on the outline generator leads. The phone signs in like any
 * other device (the /admin guard sends it to /login and back), so uploads carry
 * the teacher's own session and land in their own storage folder.
 */
export const load: PageServerLoad = async ({ locals, params }) => {
	const { data: resource } = await locals.supabase
		.from('curriculum_resource')
		.select('id, title')
		.eq('id', params.id)
		.maybeSingle();

	if (!resource) error(404, 'Resource not found.');

	return { resource: resource as { id: string; title: string } };
};
