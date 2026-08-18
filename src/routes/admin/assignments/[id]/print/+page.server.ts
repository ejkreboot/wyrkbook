import { error } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { PUBLIC_SITE_URL } from '$env/static/public';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { data: assignment } = await locals.supabase
		.from('assignment')
		.select('*')
		.eq('id', params.id)
		.maybeSingle();

	if (!assignment) error(404, 'Assignment not found.');

	const { data: problems } = await locals.supabase
		.from('problem')
		.select('*')
		.eq('assignment_id', params.id)
		.eq('included', true)
		.order('sort_order');

	const { data: klass } = await locals.supabase
		.from('class')
		.select('name')
		.eq('id', assignment.class_id)
		.maybeSingle();

	/*
	 * The QR points at the short /s/<id> route. Scanning it at the start of a work
	 * session is what tells the AI which class and assignment the photographed
	 * work belongs to, so the student never has to type any of that in.
	 */
	const origin = PUBLIC_SITE_URL?.replace(/\/$/, '') || url.origin;
	const qr = await QRCode.toString(`${origin}/s/${assignment.id}`, {
		type: 'svg',
		margin: 0,
		errorCorrectionLevel: 'M'
	});

	return {
		assignment,
		problems: problems ?? [],
		className: klass?.name ?? '',
		qr
	};
};
