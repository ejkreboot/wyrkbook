import { fail, redirect } from '@sveltejs/kit';
import { homeFor } from '$lib/nav';
import {
	authModeFor,
	checkResetPin,
	findByIdentifier,
	issueResetPin,
	passwordProblem,
	pinMessage,
	spendResetPin
} from '$lib/server/passwords';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.profile) redirect(303, homeFor(locals.profile));
	return {
		next: url.searchParams.get('next') ?? '',
		notice:
			url.searchParams.get('error') === 'no-profile'
				? 'That email signed in, but no one has added it to an organization yet. Ask your teacher to add you.'
				: ''
	};
};

/** Sign-in succeeded; land them wherever they were headed. Throws a redirect. */
async function landAfterSignIn(locals: App.Locals, next: string): Promise<never> {
	const { data } = await locals.supabase.from('profile').select('*').single();
	redirect(303, next || homeFor(data));
}

async function sendCode(locals: App.Locals, email: string) {
	// `shouldCreateUser: false` keeps the app closed: only addresses an admin has
	// already provisioned can get in.
	return locals.supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
}

function otpFailure(message: string) {
	return /signups not allowed/i.test(message) || /not found/i.test(message)
		? "That email isn't set up in wyrkbook yet."
		: message;
}

export const actions: Actions = {
	/**
	 * The fork. One identifier field serves both audiences, so the server decides
	 * which way it goes: a student gets asked for a password, everyone else gets a
	 * code in the mail. The login page asks this question over /login/mode as the
	 * identifier is typed, which makes the common case one screen instead of two —
	 * this action is what happens when that lookup has not run, which is to say
	 * with JavaScript off.
	 */
	start: async ({ request, locals }) => {
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim().toLowerCase();
		const next = String(form.get('next') ?? '');

		if (!identifier) {
			return fail(400, { stage: 'request', identifier, next, message: 'Enter your username or email.' });
		}

		if ((await authModeFor(identifier)) === 'password') {
			return { stage: 'password', identifier, next };
		}

		if (!identifier.includes('@')) {
			return fail(400, {
				stage: 'request',
				identifier,
				next,
				message: "We don't know that username. Check the spelling with your teacher."
			});
		}

		const { error } = await sendCode(locals, identifier);
		if (error) {
			return fail(400, {
				stage: 'request',
				identifier,
				next,
				message: otpFailure(error.message)
			});
		}
		return { stage: 'verify', identifier, next };
	},

	/** Students. The identifier resolves to the address GoTrue knows them by. */
	password: async ({ request, locals }) => {
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim().toLowerCase();
		const password = String(form.get('password') ?? '');
		const next = String(form.get('next') ?? '');

		const found = await findByIdentifier(identifier);
		const { error } = found
			? await locals.supabase.auth.signInWithPassword({ email: found.email, password })
			: { error: { message: 'no such account' } };

		if (error) {
			/*
			 * One message for a wrong password, a wrong username, and an account
			 * that has never had a password set — the three are indistinguishable to
			 * the person typing, and distinguishing them out loud would tell a
			 * stranger which usernames exist.
			 */
			return fail(400, {
				stage: 'password',
				identifier,
				next,
				message: "That username and password don't match. If you've forgotten it, ask for a reset code."
			});
		}

		await landAfterSignIn(locals, next);
	},

	/** Resend, from the "check your email" screen. */
	request: async ({ request, locals }) => {
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim().toLowerCase();
		const next = String(form.get('next') ?? '');

		const { error } = await sendCode(locals, identifier);
		if (error) {
			return fail(400, { stage: 'verify', identifier, next, message: otpFailure(error.message) });
		}
		return { stage: 'verify', identifier, next };
	},

	/** Teachers. Exchange the emailed code for a session. */
	verify: async ({ request, locals }) => {
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim().toLowerCase();
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
				identifier,
				next,
				message: 'Enter the code from your email.'
			});
		}

		const { error } = await locals.supabase.auth.verifyOtp({
			email: identifier,
			token,
			type: 'email'
		});
		if (error) {
			return fail(400, {
				stage: 'verify',
				identifier,
				next,
				message: 'That code was wrong or expired. Try again, or send a new one.'
			});
		}

		await landAfterSignIn(locals, next);
	},

	/**
	 * A forgotten password mints a PIN for the teacher to read out. The student
	 * never receives it — there is nowhere to send it, which is the whole reason
	 * they have a password rather than an emailed code.
	 *
	 * Always reports the same thing, whether or not the username exists: this is
	 * an unauthenticated endpoint, and an honest answer makes it a way to test
	 * whether a given student is enrolled here.
	 */
	forgot: async ({ request }) => {
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim().toLowerCase();
		const next = String(form.get('next') ?? '');

		const found = await findByIdentifier(identifier);
		// One live PIN per student (migration 008), so repeat clicks replace rather
		// than accumulate and there is nothing here to flood.
		if (found?.role === 'student' && found.org_id) {
			await issueResetPin(found.id, found.org_id);
		}

		return { stage: 'pin', identifier, next, issued: true };
	},

	/** Check the PIN before asking for a new password, so a wrong one costs one screen. */
	pin: async ({ request }) => {
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim().toLowerCase();
		const pin = String(form.get('pin') ?? '').replace(/\D/g, '');
		const next = String(form.get('next') ?? '');

		const found = await findByIdentifier(identifier);
		const check = found?.role === 'student' ? await checkResetPin(found.id, pin) : 'none';

		if (check !== 'ok') {
			return fail(400, { stage: 'pin', identifier, next, message: pinMessage(check) });
		}
		return { stage: 'choose', identifier, pin, next };
	},

	/**
	 * Spend the PIN on a password of the student's choosing, then sign them in —
	 * they have just proved who they are, and making them type it again on the
	 * previous screen is a step with nothing behind it.
	 */
	reset: async ({ request, locals }) => {
		const form = await request.formData();
		const identifier = String(form.get('identifier') ?? '').trim().toLowerCase();
		const pin = String(form.get('pin') ?? '').replace(/\D/g, '');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');
		const next = String(form.get('next') ?? '');

		const problem = passwordProblem(password, confirm);
		if (problem) {
			return fail(400, { stage: 'choose', identifier, pin, next, message: problem });
		}

		const found = await findByIdentifier(identifier);
		if (found?.role !== 'student') {
			return fail(400, { stage: 'pin', identifier, next, message: pinMessage('none') });
		}

		const result = await spendResetPin(found.id, pin, password);
		if (!result.ok) {
			// A PIN that died between the two screens sends them back to the first,
			// where the message explains what to ask the teacher for.
			return fail(400, {
				stage: result.reason === 'rejected' ? 'choose' : 'pin',
				identifier,
				pin,
				next,
				message: result.message
			});
		}

		const { error } = await locals.supabase.auth.signInWithPassword({
			email: found.email,
			password
		});
		if (error) {
			return fail(400, {
				stage: 'password',
				identifier,
				next,
				message: 'Your password was changed. Sign in with it.'
			});
		}

		await landAfterSignIn(locals, next);
	}
};
