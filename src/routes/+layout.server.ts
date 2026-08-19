import type { LayoutServerLoad } from './$types';

/**
 * Returns neither `session` nor `cookies` on purpose.
 *
 * `session` — auth-js wraps `session.user` in a Proxy that logs "Using the user
 * object as returned from supabase.auth.getSession() ... could be insecure!" on
 * any property access. SvelteKit serializes whatever a load returns, and that
 * walk touches `session.user`, so returning the session logs the warning on
 * every request even though the code never misuses it.
 *
 * `cookies` — the usual @supabase/ssr SvelteKit recipe passes cookies.getAll()
 * down so a universal load can build a browser client, which puts the auth token
 * in the SSR HTML payload. Nothing here talks to Supabase from the browser.
 *
 * `profile` is already derived from a getUser()-verified identity, so it is the
 * only thing the UI needs.
 */
export const load: LayoutServerLoad = async ({ locals }) => {
	return { profile: locals.profile };
};
