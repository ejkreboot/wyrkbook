import { error, fail, redirect } from '@sveltejs/kit';
import QRCode from 'qrcode';
import { PUBLIC_SITE_URL } from '$env/static/public';
import { addWeeks, weekStart } from '$lib/week';
import type { CurriculumResource } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

/** Generous for lecture notes; it only exists so a paste accident cannot store megabytes. */
const MAX_BODY = 200_000;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const { data: resource } = await locals.supabase
		.from('curriculum_resource')
		.select('*')
		.eq('id', params.id)
		.maybeSingle();

	if (!resource) error(404, 'Resource not found.');

	// Most of a school year either side of where it sits now, so a resource can be
	// moved to any week of the term without leaving the editor.
	const base = resource.week_start ?? weekStart();
	const weekOptions = Array.from({ length: 53 }, (_, i) => addWeeks(base, i - 12));

	/*
	 * For photographing pages with a phone: the QR opens the phone page for this
	 * resource, and the desktop listens on the Realtime topic the upload route
	 * announces into (migration 011).
	 */
	const origin = PUBLIC_SITE_URL?.replace(/\/$/, '') || url.origin;
	const phoneUrl = `${origin}/admin/curriculum/${resource.id}/phone`;
	const phone = {
		url: phoneUrl,
		qr: await QRCode.toString(phoneUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }),
		topic: `outline-pages:${locals.profile!.id}:${resource.id}`
	};

	return { resource: resource as CurriculumResource, weekOptions, phone };
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const form = await request.formData();

		const patch = {
			title: String(form.get('title') ?? '').trim(),
			class_id: String(form.get('class_id') ?? ''),
			week_start: String(form.get('week_start') ?? '') || null,
			/*
			 * Not trimmed: leading indentation can be a code block, and the editor
			 * compares what it sent with what comes back to decide it is saved. The
			 * CRLFs are the browser's — form submission turns a textarea's \n into
			 * \r\n — and would otherwise make every save look like an edit.
			 */
			body: String(form.get('body') ?? '').replace(/\r\n?/g, '\n'),
			updated_at: new Date().toISOString()
		};

		if (!patch.title) return fail(400, { message: 'Give the resource a title.' });
		if (!patch.class_id) return fail(400, { message: 'Choose a class.' });
		if (patch.body.length > MAX_BODY) {
			return fail(400, { message: `That is over ${MAX_BODY.toLocaleString()} characters — split it up.` });
		}

		const { error: e } = await locals.supabase
			.from('curriculum_resource')
			.update(patch)
			.eq('id', params.id);
		if (e) return fail(400, { message: e.message });

		return { message: 'Saved.' };
	},

	remove: async ({ locals, params }) => {
		const { error: e } = await locals.supabase
			.from('curriculum_resource')
			.delete()
			.eq('id', params.id);
		if (e) return fail(400, { message: e.message });
		redirect(303, '/admin/curriculum');
	}
};
