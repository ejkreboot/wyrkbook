import { error } from '@sveltejs/kit';
import type { CurriculumResource } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { data: resource } = await locals.supabase
		.from('curriculum_resource')
		.select('*')
		.eq('id', params.id)
		.maybeSingle();

	if (!resource) error(404, 'Resource not found.');

	const { data: klass } = await locals.supabase
		.from('class')
		.select('name')
		.eq('id', resource.class_id)
		.maybeSingle();

	return {
		resource: resource as CurriculumResource,
		className: klass?.name ?? '',
		// Handout unless asked otherwise: the safe default is the one without notes.
		notes: url.searchParams.get('notes') === '1'
	};
};
