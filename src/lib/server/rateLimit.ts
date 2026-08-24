import { createHash } from 'node:crypto';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

/**
 * Rate limits for the sign-in surface, which is the only part of wyrkbook an
 * unauthenticated stranger can reach. Counting happens in Postgres — see
 * migration 009 for why it cannot happen in the process.
 *
 * Two buckets guard each action: one on who is being tried, one on who is doing
 * the trying. Neither works alone. A per-account limit does nothing against
 * someone walking a list of usernames; a per-address limit does nothing against
 * a distributed attempt on one account, and it has to stay loose anyway because
 * a household — the unit this app is built around — shares one address.
 */
const BUCKETS = {
	/** Password attempts. Loose enough for a nine-year-old having a bad morning. */
	'signin:user': { limit: 10, windowSeconds: 15 * 60 },
	'signin:ip': { limit: 40, windowSeconds: 15 * 60 },

	/** Emailed codes. Each one is a real email; Supabase throttles these too. */
	'code:user': { limit: 5, windowSeconds: 60 * 60 },
	'code:ip': { limit: 20, windowSeconds: 60 * 60 },

	/** Minting reset PINs. Tight: every one of these invalidates the last. */
	'forgot:user': { limit: 3, windowSeconds: 60 * 60 },
	'forgot:ip': { limit: 12, windowSeconds: 60 * 60 },

	/**
	 * PIN guesses. A single PIN burns after five wrong tries on its own, so this
	 * bucket is really about someone trying one guess against each of many
	 * students in turn — which the per-account counter cannot see.
	 */
	'pin:ip': { limit: 15, windowSeconds: 60 * 60 },

	/**
	 * Username lookups from the login form. Generous because it fires while
	 * someone types, and still far below what enumerating a roster would need.
	 */
	'lookup:ip': { limit: 90, windowSeconds: 5 * 60 }
} as const;

export type Bucket = keyof typeof BUCKETS;

/** Shown whenever a limit bites. Deliberately vague about which one. */
export const THROTTLED = 'Too many tries. Wait a few minutes and try again.';

/**
 * Values are hashed before they become keys, so the table never accumulates the
 * addresses and usernames people type at the login form — including the wrong
 * guesses, which are the ones we have no business keeping.
 */
function keyFor(bucket: Bucket, value: string): string {
	const digest = createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
	return `${bucket}:${digest.slice(0, 32)}`;
}

/**
 * Count one hit against every listed bucket and report whether all of them are
 * still under their limit.
 *
 * All buckets are counted even once one has failed, so the counters stay in step
 * with each other rather than depending on which check ran first.
 *
 * Fails open. If the limiter itself is broken, the choice is between letting
 * traffic through and locking every student out of their schoolwork over a
 * database hiccup, and the second is the worse outcome by a distance.
 */
export async function withinLimits(checks: [Bucket, string][]): Promise<boolean> {
	const results = await Promise.all(
		checks.map(async ([bucket, value]) => {
			const { limit, windowSeconds } = BUCKETS[bucket];
			const { data, error } = await supabaseAdmin.rpc('wb_rate_limit', {
				p_key: keyFor(bucket, value),
				p_limit: limit,
				p_window_seconds: windowSeconds
			});
			if (error) {
				console.error('rate limit check failed, allowing through:', error.message);
				return true;
			}
			return data !== false;
		})
	);

	return results.every(Boolean);
}
