import { createServerClient } from '@supabase/ssr';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { json, redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { homeFor } from '$lib/nav';
import type { Profile } from '$lib/types';

const supabase: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					event.cookies.set(name, value, { ...options, path: '/' });
				}
			}
		}
	});

	/**
	 * getSession() alone trusts the cookie without verifying its signature, so the
	 * session is only returned once getUser() has validated the JWT against the
	 * auth server.
	 */
	event.locals.safeGetSession = async () => {
		const {
			data: { session }
		} = await event.locals.supabase.auth.getSession();
		if (!session) return { session: null, user: null };

		const {
			data: { user },
			error
		} = await event.locals.supabase.auth.getUser();
		if (error) return { session: null, user: null };

		return { session, user };
	};

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};

const PUBLIC_ROUTES = ['/login', '/auth', '/logout'];

const guard: Handle = async ({ event, resolve }) => {
	const { session, user } = await event.locals.safeGetSession();
	event.locals.session = session;
	event.locals.user = user;
	event.locals.profile = null;

	if (user) {
		const { data } = await event.locals.supabase
			.from('profile')
			.select('*')
			.eq('id', user.id)
			.maybeSingle();
		event.locals.profile = (data as Profile) ?? null;
	}

	const path = event.url.pathname;
	const isPublic = PUBLIC_ROUTES.some((p) => path === p || path.startsWith(p + '/'));
	const isApi = path.startsWith('/api/');

	if (!isPublic && !event.locals.profile) {
		/*
		 * A fetch() to /api/* must fail as JSON, not as a redirect to the login
		 * page — otherwise a session that expires mid-assignment surfaces to the
		 * student as an unreadable chunk of HTML instead of "sign in again".
		 */
		if (isApi) {
			return json({ message: 'Your session expired. Sign in again.' }, { status: 401 });
		}
		redirect(
			303,
			session
				? // Signed in but unprovisioned: an auth user nobody has added to an org.
					'/login?error=no-profile'
				: `/login?next=${encodeURIComponent(path)}`
		);
	}

	const profile = event.locals.profile;
	if (profile) {
		if (path.startsWith('/sysadmin') && profile.role !== 'sysadmin') {
			redirect(303, homeFor(profile));
		}
		if (path.startsWith('/admin') && !['admin', 'sysadmin'].includes(profile.role)) {
			redirect(303, homeFor(profile));
		}
		// Admins are allowed to preview the student surface; only the reverse is blocked.
		if (path.startsWith('/student') && profile.role === 'sysadmin') {
			redirect(303, homeFor(profile));
		}
	}

	return resolve(event);
};

export const handle = sequence(supabase, guard);
