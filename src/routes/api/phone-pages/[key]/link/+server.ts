import { error, json } from '@sveltejs/kit';
import { checkedKey, checkedPurpose, phoneLinkFor, requireTeacher } from '$lib/server/phonePages';
import type { RequestHandler } from './$types';

/**
 * A freshly signed phone link for this key, as a QR, plus the channel its
 * uploads are announced on. The desktop asks again before the old one expires.
 * `?for=` says which page is waiting: `outline` (the default) or `assignment`.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const teacher = requireTeacher(locals);
	const purpose = checkedPurpose(url.searchParams.get('for'));
	const key = checkedKey(params.key);

	if (purpose === 'outline') {
		// Visible to this teacher under RLS, or no link.
		const { data: resource } = await locals.supabase
			.from('curriculum_resource')
			.select('id')
			.eq('id', key)
			.maybeSingle();
		if (!resource) error(404, 'Resource not found.');
	}
	// A new assignment has no row to check: its key is made up by the page, and
	// only ever names a folder under this teacher's own.

	return json(await phoneLinkFor(teacher, purpose, key, url.origin), {
		headers: { 'cache-control': 'no-store' }
	});
};
