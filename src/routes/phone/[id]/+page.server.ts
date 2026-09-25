import { openPhoneLink } from '$lib/server/outlinePages';
import type { PageServerLoad } from './$types';

/**
 * Where the QR on the outline generator leads. The phone is not signed in; the
 * `t` in the link is what lets it send pages, and only for this resource, only
 * to the teacher who showed the code, and only until it expires.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const token = url.searchParams.get('t');
	const link = await openPhoneLink(params.id, token);
	return { resourceId: link.resourceId, title: link.title, token: token! };
};
