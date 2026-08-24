import { json } from '@sveltejs/kit';
import { authModeFor } from '$lib/server/passwords';
import type { RequestHandler } from './$types';

/**
 * Which credential does this identifier want? The login form asks as the field
 * is typed, so a student sees a password box and a teacher sees "email me a
 * code" without either of them submitting a page first.
 *
 * POST rather than GET with a query string, so usernames stay out of access logs
 * and browser history. The answer is deliberately uninformative about whether
 * the account exists — see `authModeFor`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const identifier = String(body?.identifier ?? '');
	return json({ mode: await authModeFor(identifier) });
};
