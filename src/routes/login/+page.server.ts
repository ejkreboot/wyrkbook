import { fail, redirect } from '@sveltejs/kit';
import { homeFor } from '$lib/nav';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.profile) redirect(303, homeFor(locals.profile));
	return {
		next: url.searchParams.get('next') ?? '',
		notice: url.searchParams.get('error') === 'no-profile'
			? 'That email signed in, but no one has added it to an organization yet. Ask your teacher to add you.'
			: ''
	};
};

export const actions: Actions = {
	/**
	 * Step 1 — mail a code. `shouldCreateUser: false` keeps the app closed: only
	 * emails an admin has already provisioned can get in.
	 */
	request: async ({ request, locals }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const next = String(form.get('next') ?? '');

		if (!email || !email.includes('@')) {
			return fail(400, { stage: 'request', email, message: 'Enter a valid email address.' });
		}

		const { error } = await locals.supabase.auth.signInWithOtp({
			email,
			options: { shouldCreateUser: false }
		});

		if (error) {
			return fail(400, {
				stage: 'request',
				email,
				message:
					error.status === 422 || /signups not allowed/i.test(error.message)
						? "That email isn't set up in wyrkbook yet."
						: error.message
			});
		}

		return { stage: 'verify', email, next };
	},

	/** Step 2 — exchange the emailed code for a session. */
	verify: async ({ request, locals }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim().toLowerCase();
		const token = String(form.get('token') ?? '').replace(/\D/g, '');
		const next = String(form.get('next') ?? '');

		/*
		 * Deliberately not pinned to a digit count. Supabase's mailer_otp_length is
		 * a project setting (currently 8), and hardcoding a length here means the
		 * form silently rejects valid codes the moment that setting changes.
		 * verifyOtp is the authority on whether a code is right.
		 */
		if (token.length < 4) {
			return fail(400, {
				stage: 'verify',
				email,
				next,
				message: 'Enter the code from your email.'
			});
		}

		const { error } = await locals.supabase.auth.verifyOtp({ email, token, type: 'email' });
		if (error) {
			return fail(400, {
				stage: 'verify',
				email,
				next,
				message: 'That code was wrong or expired. Try again, or send a new one.'
			});
		}

		const { data } = await locals.supabase.from('profile').select('*').single();
		redirect(303, next || homeFor(data));
	}
};
