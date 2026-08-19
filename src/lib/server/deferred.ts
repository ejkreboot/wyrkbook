import { getDeadline, waitUntil } from '@vercel/functions';

/**
 * Work that outlives the response that started it.
 *
 * `waitUntil` extends the function invocation for the lifetime of the promise,
 * so the upload can answer in a second while the ninety-second model call keeps
 * running behind it. The promise is still bound by the route's `maxDuration`;
 * if the invocation is killed the promise is cancelled with it, which is what
 * `deadline()` below is for.
 */
export function defer(work: Promise<unknown>): void {
	// Attached first: an unhandled rejection in a detached promise takes the
	// whole process down, and the job row would never be marked failed.
	const guarded = work.catch((e) => {
		console.error('[deferred] background work failed', e);
	});

	if (process.env.VERCEL) {
		waitUntil(guarded);
		return;
	}

	/*
	 * Outside Vercel — `vite dev`, `npm run preview` — there is no invocation to
	 * extend and `waitUntil` does nothing. The dev server is a long-lived
	 * process, so simply letting the promise run loose behaves the same way.
	 * This is the only branch that would silently drop work on a different
	 * serverless host.
	 */
	void guarded;
}

const FALLBACK_MS = 10 * 60 * 1000;

/**
 * When the current invocation will be terminated. Used to stamp an expiry on a
 * job row so a job whose function died can be told apart from one still
 * working, without a heartbeat. Off-platform there is no deadline, so this
 * falls back to a window longer than any job should take.
 */
export function deadline(): Date {
	return getDeadline() ?? new Date(Date.now() + FALLBACK_MS);
}
