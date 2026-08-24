import { json } from '@sveltejs/kit';
import { authModeFor } from '$lib/server/passwords';
import { withinLimits } from '$lib/server/rateLimit';
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
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	/*
	 * Throttled as the roster-enumeration tool it would otherwise be. Refusals
	 * answer 'otp' rather than erroring: the login form reads that as "no
	 * password box yet", which leaves the person with a working sign-in through
	 * the `start` action — carrying its own limit — instead of a broken page.
	 */
	if (!(await withinLimits([['lookup:ip', getClientAddress()]]))) {
		return json({ mode: 'otp' }, { status: 429 });
	}

	const body = await request.json().catch(() => null);
	const identifier = String(body?.identifier ?? '');
	return json({ mode: await authModeFor(identifier) });
};
