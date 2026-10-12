import { openPhoneLink } from '$lib/server/phonePages';
import type { PageServerLoad } from './$types';

/**
 * Where the QR on the outline generator or a new assignment leads. The phone is
 * not signed in; the `t` in the link is what lets it send pages, and only to the
 * page that showed the code, for the teacher using it, until it expires.
 */
export const load: PageServerLoad = async ({ params, url }) => {
	const token = url.searchParams.get('t');
	const link = await openPhoneLink(params.id, token);
	return { purpose: link.purpose, key: link.key, title: link.title, token: token! };
};
