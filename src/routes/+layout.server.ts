import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	return {
		session: locals.session,
		profile: locals.profile,
		cookies: cookies.getAll()
	};
};
