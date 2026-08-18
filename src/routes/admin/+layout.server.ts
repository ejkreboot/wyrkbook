import type { LayoutServerLoad } from './$types';
import type { Klass } from '$lib/types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const { data } = await locals.supabase
		.from('class')
		.select('*')
		.eq('archived', false)
		.order('name');

	return { classes: (data ?? []) as Klass[] };
};
