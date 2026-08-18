import { redirect } from '@sveltejs/kit';
import { homeFor } from '$lib/nav';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	redirect(303, homeFor(locals.profile));
};
