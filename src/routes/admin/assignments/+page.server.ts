import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const classFilter = url.searchParams.get('class') ?? '';
	const statusFilter = url.searchParams.get('status') ?? '';

	let q = locals.supabase
		.from('assignment')
		.select('*, problem(count), submission(count)')
		.order('created_at', { ascending: false });

	if (classFilter) q = q.eq('class_id', classFilter);
	if (statusFilter) q = q.eq('status', statusFilter);

	const { data } = await q;

	return {
		assignments: data ?? [],
		classFilter,
		statusFilter
	};
};
